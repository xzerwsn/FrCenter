from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]
PROJECT_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(PROJECT_ROOT / ".env", BACKEND_ROOT / ".env"),
        env_file_encoding="utf-8",
    )

    app_name: str = "FrCenter"
    app_env: str = "development"
    app_secret_key: str = "change_me"

    database_url: str = "postgresql+asyncpg://frcenter:password@localhost:5432/frcenter"
    redis_url: str = "redis://localhost:6379/0"

    smtp_host: str = "smtp.mail.ru"
    smtp_port: int = 465
    smtp_username: str = "your_email@mail.ru"
    smtp_password: str = "your_app_password"
    smtp_from: str = "your_email@mail.ru"
    smtp_use_ssl: bool = True

    media_storage_path: str = "./backend/app/storage"
    message_ttl_seconds: int = 7200

    frontend_url: str = "http://localhost:5173"
    backend_url: str = "http://localhost:8000"
    access_token_expire_minutes: int = 60 * 24 * 7
    email_confirmation_expire_minutes: int = 30
    sql_echo: bool = False
    auto_create_tables: bool = False


settings = Settings()
