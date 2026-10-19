"""
LLM Provider Abstraction.

Sits behind a single unified interface chosen by environment variable (LLM_PROVIDER):
- "fake" (default): Returns canned fixture plans or queued responses.
  Requires zero internet, zero database, zero API keys. Perfect for offline pytest tests.
- "openai": Standard OpenAI API (when OPENAI_API_KEY is configured).
- "gemini": Google Gemini API (when GEMINI_API_KEY is configured).
"""
from __future__ import annotations

from abc import ABC, abstractmethod
import json
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

# Automatically load .env from backend/ or project root if present
_root = Path(__file__).resolve().parent.parent.parent.parent
load_dotenv(_root / "backend" / ".env")
load_dotenv(_root / ".env")


class LLMProvider(ABC):
    """Abstract interface for all LLM providers."""

    @abstractmethod
    def generate(self, system_prompt: str, user_prompt: str) -> str:
        """Generates raw text completion from system and user prompts."""
        pass


class FakeLLMProvider(LLMProvider):
    """
    Deterministic, offline test provider.
    Can be loaded with:
    - Default fixture plan matching PO processing time
    - A queue of custom responses (e.g. invalid JSON first, valid JSON second to test retries)
    """

    def __init__(self, responses: list[str] | None = None, default_plan: dict[str, Any] | None = None):
        self.responses = list(responses) if responses else []
        self.call_history: list[dict[str, str]] = []
        self.default_plan = default_plan or DEFAULT_FIXTURE_PLAN

    def queue_response(self, response: str) -> None:
        """Queues a response to be returned on subsequent generate calls."""
        self.responses.append(response)

    def generate(self, system_prompt: str, user_prompt: str) -> str:
        self.call_history.append({"system": system_prompt, "user": user_prompt})

        if self.responses:
            return self.responses.pop(0)

        return json.dumps(self.default_plan)


class OpenAILLMProvider(LLMProvider):
    """OpenAI API provider."""

    def __init__(self, api_key: str | None = None, model: str | None = None):
        self.api_key = api_key or os.getenv("OPENAI_API_KEY", "")
        self.model = model or os.getenv("LLM_MODEL", "gpt-4o")

    def generate(self, system_prompt: str, user_prompt: str) -> str:
        from openai import OpenAI

        client = OpenAI(api_key=self.api_key)
        response = client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0.0,
        )
        return response.choices[0].message.content or "{}"


import logging

logger = logging.getLogger(__name__)


class GeminiLLMProvider(LLMProvider):
    """Google Gemini API provider."""

    def __init__(self, api_key: str | None = None, model: str | None = None):
        self.api_key = api_key or os.getenv("GEMINI_API_KEY", "")
        self.model = model or os.getenv("GEMINI_MODEL") or os.getenv("LLM_MODEL", "gemini-2.5-flash")

    def generate(self, system_prompt: str, user_prompt: str) -> str:
        from google import genai

        client = genai.Client(api_key=self.api_key)
        models_to_try = [self.model]
        for fallback in ("gemini-3.5-flash-lite", "gemini-3.8-flash"):
            if fallback not in models_to_try:
                models_to_try.append(fallback)

        last_err = None
        for m in models_to_try:
            try:
                response = client.models.generate_content(
                    model=m,
                    contents=user_prompt,
                    config={"system_instruction": system_prompt, "response_mime_type": "application/json"},
                )
                if response.text:
                    return response.text
            except Exception as e:
                logger.warning(f"Gemini model {m} call failed ({e}), attempting next available model...")
                last_err = e

        if last_err:
            raise last_err
        return "{}"


def get_llm_provider(provider_name: str | None = None) -> LLMProvider:
    """
    Factory: returns the configured provider.
    - If GEMINI_API_KEY is present or LLM_PROVIDER=gemini -> GeminiLLMProvider (Live Real LLM)
    - If OPENAI_API_KEY is present or LLM_PROVIDER=openai -> OpenAILLMProvider (Live Real LLM)
    - If LLM_PROVIDER=fake or no keys present -> FakeLLMProvider (Offline deterministic test mock)
    """
    explicit = (provider_name or os.getenv("LLM_PROVIDER", "")).strip().lower()

    if explicit in ("gemini", "google"):
        return GeminiLLMProvider()
    if explicit == "openai":
        return OpenAILLMProvider()
    if explicit == "fake":
        return FakeLLMProvider()

    # Auto-detect if API keys are set in environment
    if os.getenv("GEMINI_API_KEY"):
        logger.info("Using real GeminiLLMProvider (detected GEMINI_API_KEY)")
        return GeminiLLMProvider()
    if os.getenv("OPENAI_API_KEY"):
        logger.info("Using real OpenAILLMProvider (detected OPENAI_API_KEY)")
        return OpenAILLMProvider()

    logger.warning(
        "No GEMINI_API_KEY or OPENAI_API_KEY set. Defaulting to offline FakeLLMProvider. "
        "Set GEMINI_API_KEY or OPENAI_API_KEY to enable live real-time LLM reasoning."
    )
    return FakeLLMProvider()


# Default valid PO Processing Time plan used by FakeLLMProvider
DEFAULT_FIXTURE_PLAN: dict[str, Any] = {
    "analysis": [
        "Requirement: Compute Purchase Order Average Processing Time (APT).",
        "Source metadata includes existing view V_PO_FINAL_DELIVERY_APT which filters movement type 101 and aggregates maximum delivery date per PO.",
        "Join existing view V_PO_FINAL_DELIVERY_APT with PO header ZIPOHDRAPT on PURCHASEORDER to calculate processing duration.",
        "Data profile confirms key match between ZIPOHDRAPT and V_PO_FINAL_DELIVERY_APT on PURCHASEORDER.",
    ],
    "nodes": [
        {
            "id": "V_PO_FINAL_DELIVERY_APT",
            "operation": "projection",
            "inputs": ["ZIPOHISTEXT"],
            "columns": ["PURCHASEORDER", "FINAL_DELIVERY_DATE"],
            "details": {
                "join_type": "",
                "on": [],
                "condition": "GOODSMOVEMENTTYPE = '101'",
                "formula": "MAX(POSTINGDATE)",
                "aggregation": "MAX",
            },
            "reason": "Reuses existing CDS view V_PO_FINAL_DELIVERY_APT which pre-calculates final delivery date.",
            "is_existing": True,
            "layer": "L2",
        },
        {
            "id": "F_PO_PROCESSING_TIME_APT",
            "operation": "join",
            "inputs": ["ZIPOHDRAPT", "V_PO_FINAL_DELIVERY_APT"],
            "columns": [
                "PURCHASEORDER",
                "COMPANYCODE",
                "PURCHASINGORGANIZATION",
                "PURCHASINGGROUP",
                "SUPPLIER",
                "CREATIONDATE",
                "FINAL_DELIVERY_DATE",
            ],
            "details": {
                "join_type": "inner",
                "on": [["ZIPOHDRAPT.PURCHASEORDER", "V_PO_FINAL_DELIVERY_APT.PURCHASEORDER"]],
                "condition": "",
                "formula": "",
                "aggregation": "",
            },
            "reason": "Inner join header and existing final delivery view on PURCHASEORDER (profile shows 100% match).",
            "is_existing": False,
            "layer": "L3",
        },
        {
            "id": "CALC_PROCESSING_DAYS",
            "operation": "calculated_column",
            "inputs": ["F_PO_PROCESSING_TIME_APT"],
            "columns": ["Processing_Days", "Total_Delivered_Order"],
            "details": {
                "join_type": "",
                "on": [],
                "condition": "",
                "formula": "DAYS_BETWEEN(TO_DATE(CREATIONDATE), TO_DATE(FINAL_DELIVERY_DATE)) + 1",
                "aggregation": "",
            },
            "reason": "Compute processing duration in days and base delivery counter.",
            "is_existing": False,
            "layer": "L3",
        },
        {
            "id": "AM_PO_APT",
            "operation": "analytic_model",
            "inputs": ["CALC_PROCESSING_DAYS"],
            "columns": [
                "PURCHASEORDER",
                "SUPPLIER",
                "COMPANYCODE",
                "Processing_Days",
                "Total_Delivered_Order",
            ],
            "details": {
                "join_type": "",
                "on": [],
                "condition": "",
                "formula": "Processing_Days / Total_Delivered_Order",
                "aggregation": "FORMULA",
            },
            "reason": "Analytic model exposing APT KPI aggregated across supplier and organizational dimensions.",
            "is_existing": False,
            "layer": "L4",
        },
    ],
    "measures": [
        {"name": "Total_Delivered_Order", "aggregation": "SUM", "column": "Total_Delivered_Order"},
        {"name": "Processing_Days", "aggregation": "SUM", "column": "Processing_Days"},
        {"name": "APT", "aggregation": "FORMULA", "column": "Processing_Days"},
    ],
    "dimensions": ["PURCHASEORDER", "SUPPLIER", "COMPANYCODE"],
    "assumptions": ["Dates in CREATIONDATE and FINAL_DELIVERY_DATE are YYYYMMDD strings."],
    "blockers": [],
}
