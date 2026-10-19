"""
DS ModelForge — Configuration
All settings read from environment variables / .env file.
Credentials are NEVER stored in the database.
"""
from functools import lru_cache
from typing import Literal, Any
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env", "backend/.env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Application
    app_env: str = "development"
    app_title: str = "DS ModelForge"
    app_version: str = "1.0.0"
    secret_key: str = "changeme-use-openssl-rand-hex-32"
    allowed_origins: list[str] | str = ["http://localhost:3000", "http://localhost:3001"]

    @field_validator("allowed_origins")
    @classmethod
    def assemble_cors_origins(cls, v: Any) -> list[str]:
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("[") and v.endswith("]"):
                import json
                try:
                    return json.loads(v)
                except Exception:
                    pass
            return [i.strip() for i in v.split(",") if i.strip()]
        elif isinstance(v, (list, tuple)):
            return list(v)
        return ["*"]

    # Database
    database_url: str = "postgresql+asyncpg://modelforge:modelforge@localhost:5432/modelforge"
    sync_database_url: str = "postgresql://modelforge:modelforge@localhost:5432/modelforge"

    # JWT
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 480
    argon2_time_cost: int = 2
    argon2_memory_cost: int = 65536

    # LLM
    llm_provider: str = "gemini"
    llm_model: str = "gemini-2.5-flash"
    llm_temperature: float = 0.0

    openai_api_key: str | None = None
    azure_openai_api_key: str | None = None
    azure_openai_endpoint: str | None = None
    azure_openai_deployment: str | None = None
    azure_openai_api_version: str = "2024-02-01"
    anthropic_api_key: str | None = None
    gemini_api_key: str | None = None
    google_api_key: str | None = None

    # Embeddings (local)
    embedding_model: str = "all-MiniLM-L6-v2"
    embedding_dimension: int = 384

    # Datasphere defaults (overridden per-connection at runtime)
    ds_token_url: str | None = None
    ds_client_id: str | None = None
    ds_client_secret: str | None = None
    ds_tenant_host: str | None = None
    ds_space: str | None = None
    ds_release: str = "2024.Q3"

    # JDBC
    jdbc_driver_path: str = "/opt/jdbc/ngdbc.jar"
    jdbc_driver_class: str = "com.sap.db.jdbc.Driver"

    # Feature flags
    profiling_sample_rows: int = 10_000_000
    profiling_top_k: int = 20
    association_orphan_threshold: float = 0.02
    confidence_flag_threshold: float = 0.75

    # Worker
    worker_concurrency: int = 4
    langgraph_interrupt_timeout: int = 3600


@lru_cache
def get_settings() -> Settings:
    return Settings()
