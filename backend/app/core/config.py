from pathlib import Path

from pydantic import field_validator
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
    media_storage_backend: str = "filesystem"
    message_ttl_seconds: int = 7200

    frontend_url: str = "http://localhost:5173"
    frontend_origins_csv: str = (
        "http://localhost:5173,"
        "http://127.0.0.1:5173,"
        "http://tauri.localhost,"
        "https://tauri.localhost,"
        "tauri://localhost"
    )
    frontend_origin_regex: str = (
        r"^https?://"
        r"(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|"
        r"172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|26\.\d+\.\d+\.\d+)"
        r"(?::\d+)?$"
    )
    backend_url: str = "http://localhost:8000"
    steam_web_api_key: str = ""
    steam_web_api_base_url: str = "https://api.steampowered.com"
    steam_openid_login_url: str = "https://steamcommunity.com/openid/login"
    riot_client_id: str = ""
    riot_client_secret: str = ""
    riot_authorize_url: str = "https://auth.riotgames.com/authorize"
    riot_token_url: str = "https://auth.riotgames.com/token"
    riot_account_api_urls_csv: str = (
        "https://europe.api.riotgames.com/riot/account/v1/accounts/me,"
        "https://americas.api.riotgames.com/riot/account/v1/accounts/me,"
        "https://asia.api.riotgames.com/riot/account/v1/accounts/me"
    )
    riot_val_match_regions_csv: str = "europe,americas,asia"
    auth_cookie_name: str = "frcenter_session"
    auth_cookie_samesite: str = "lax"
    access_token_expire_minutes: int = 60 * 24 * 7
    email_confirmation_expire_minutes: int = 30
    sql_echo: bool = False
    auto_create_tables: bool = False
    deploy_notification_key: str = ""
    deploy_notification_title: str = "Обновление сайта"
    deploy_notification_body: str = ""
    deploy_notification_has_changes: bool = False

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        if not isinstance(value, str):
            return value
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+asyncpg://", 1)
        if value.startswith("postgresql://") and "+asyncpg" not in value:
            return value.replace("postgresql://", "postgresql+asyncpg://", 1)
        return value

    @property
    def frontend_origins(self) -> list[str]:
        origins = [item.strip() for item in self.frontend_origins_csv.split(",") if item.strip()]
        if self.frontend_url not in origins:
            origins.append(self.frontend_url)
        return origins

    @property
    def auth_cookie_secure(self) -> bool:
        return self.app_env != "development"

    @property
    def effective_auth_cookie_samesite(self) -> str:
        value = (self.auth_cookie_samesite or "lax").strip().lower()
        if self.app_env != "development":
            return "none"
        if value not in {"lax", "strict", "none"}:
            return "lax"
        return value

    @property
    def steam_enabled(self) -> bool:
        return bool(self.steam_web_api_key.strip())

    @property
    def riot_enabled(self) -> bool:
        return bool(self.riot_client_id.strip() and self.riot_client_secret.strip())

    @property
    def steam_callback_url(self) -> str:
        return f"{self.backend_url.rstrip('/')}/api/games/steam/callback"

    @property
    def riot_callback_url(self) -> str:
        return f"{self.backend_url.rstrip('/')}/api/games/riot/callback"

    @property
    def riot_account_api_urls(self) -> list[str]:
        return [item.strip() for item in self.riot_account_api_urls_csv.split(",") if item.strip()]

    @property
    def riot_val_match_regions(self) -> list[str]:
        return [item.strip() for item in self.riot_val_match_regions_csv.split(",") if item.strip()]


settings = Settings()
