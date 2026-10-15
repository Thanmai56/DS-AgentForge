"""
BTP OAuth2 Client Credentials token fetch + refresh.
Credentials come ONLY from env vars / secret store — never from DB.
"""
import hashlib
import time
import logging
from dataclasses import dataclass, field

import requests
from requests.exceptions import RequestException
from tenacity import retry, stop_after_attempt, wait_exponential

logger = logging.getLogger(__name__)


@dataclass
class TokenCache:
    access_token: str = ""
    expires_at: float = 0.0
    scope: str = ""

    def is_valid(self, buffer_seconds: int = 60) -> bool:
        return bool(self.access_token) and time.time() < (self.expires_at - buffer_seconds)


# Per-connection token cache (keyed by masked client_id)
_token_cache: dict[str, TokenCache] = {}


def _cache_key(token_url: str, client_id: str) -> str:
    return hashlib.sha256(f"{token_url}:{client_id}".encode()).hexdigest()[:16]


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
def _fetch_token(token_url: str, client_id: str, client_secret: str) -> dict:
    """Raw OAuth2 client credentials grant."""
    response = requests.post(
        token_url,
        data={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()


def get_token(token_url: str, client_id: str, client_secret: str) -> str:
    """
    Return a valid BTP OAuth2 access token.
    Uses in-memory cache; refreshes automatically before expiry.
    client_secret is only ever in memory — NEVER logged or persisted.
    """
    key = _cache_key(token_url, client_id)
    cache = _token_cache.get(key, TokenCache())

    if cache.is_valid():
        return cache.access_token

    logger.info("Fetching new OAuth2 token for client_id=%s...", client_id[:8] + "***")
    try:
        token_data = _fetch_token(token_url, client_id, client_secret)
    except RequestException as exc:
        raise RuntimeError(f"BTP OAuth2 token fetch failed: {exc}") from exc

    cache.access_token = token_data["access_token"]
    cache.expires_at = time.time() + token_data.get("expires_in", 3600)
    cache.scope = token_data.get("scope", "")
    _token_cache[key] = cache

    logger.info("Token acquired, expires in %ds", token_data.get("expires_in", 3600))
    return cache.access_token


def invalidate_token(token_url: str, client_id: str) -> None:
    """Force refresh on next call."""
    key = _cache_key(token_url, client_id)
    _token_cache.pop(key, None)


def test_connection(token_url: str, client_id: str, client_secret: str, tenant_host: str) -> dict:
    """
    Test DS connectivity:
    1. Fetch OAuth2 token
    2. Ping tenant host
    Returns {"ok": bool, "message": str, "ds_release": str | None}
    """
    try:
        token = get_token(token_url, client_id, client_secret)
    except Exception as exc:
        return {"ok": False, "message": f"OAuth2 failed: {exc}", "ds_release": None}

    try:
        resp = requests.get(
            f"{tenant_host.rstrip('/')}/api/v1/meta/release",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        ds_release = None
        if resp.ok:
            try:
                ds_release = resp.json().get("release")
            except Exception:
                ds_release = "unknown"
        return {"ok": True, "message": "Connection successful", "ds_release": ds_release}
    except RequestException as exc:
        return {"ok": False, "message": f"Tenant unreachable: {exc}", "ds_release": None}
