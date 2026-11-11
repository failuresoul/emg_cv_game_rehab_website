from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

SERVER_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=SERVER_DIR / ".env", extra="ignore")

    APP_NAME: str = "MotionLab"
    DATABASE_URL: str = "sqlite:///../data/motionlab.db"
    JWT_SECRET: str
    JWT_EXPIRE_MINUTES: int = 720
    ADMIN_EMAIL: str
    ADMIN_PASSWORD: str
    ADMIN_NAME: str
    # Comma-separated list of allowed origins.
    CORS_ORIGINS: str = "http://localhost:5173"
    # The game settings exported by the web app. Empty: shared/game-specs.json in the repository.
    GAME_SPECS_PATH: str = ""
    # The measures MotionLab reports. Empty: shared/metrics-catalog.json in the repository.
    METRICS_CATALOG_PATH: str = ""

    @property
    def game_specs_path(self) -> Path:
        if self.GAME_SPECS_PATH:
            return Path(self.GAME_SPECS_PATH)
        return SERVER_DIR.parent / "shared" / "game-specs.json"

    @property
    def metrics_catalog_path(self) -> Path:
        if self.METRICS_CATALOG_PATH:
            return Path(self.METRICS_CATALOG_PATH)
        return SERVER_DIR.parent / "shared" / "metrics-catalog.json"

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]


settings = Settings()
