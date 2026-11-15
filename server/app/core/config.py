from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

SERVER_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=SERVER_DIR / ".env", extra="ignore")

    APP_NAME: str = "MuVi Rehab"
    # "development", "production" or "test". Only "test" adds the /api/test routes (Day 18),
    # which reset the database: never set it on a database you want to keep.
    APP_ENV: str = "development"
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
    # The measured MDCs (Day 19). Empty: analysis/results/validation/mdc.json, if it exists.
    MDC_PATH: str = ""
    # The fixed safety notices. Empty: shared/safety-notices.json in the repository.
    SAFETY_NOTICES_PATH: str = ""
    # Minutes of active game play after which the games suggest finishing soon, then finishing.
    SESSION_FINISH_SOON_MIN: float = 25.0
    SESSION_FINISH_MIN: float = 35.0
    # The LLM feedback module (app/feedback): "ollama" or "mock" (tests always use mock).
    LLM_PROVIDER: str = "mock"
    OLLAMA_URL: str = "http://localhost:11434"
    LLM_MODEL: str = "qwen3.5:4b"
    # Comma-separated models compared by the speed test and the evaluation.
    LLM_MODELS_CANDIDATES: str = "qwen3.5:4b,qwen3.5:2b,phi4-mini"
    LLM_TEMPERATURE: float = 0.2
    LLM_TOP_P: float = 0.9
    LLM_NUM_CTX: int = 4096
    LLM_MAX_TOKENS: int = 700
    LLM_TIMEOUT_S: float = 60.0
    LLM_KEEP_ALIVE: str = "30m"
    # A report job's total time limit (all attempts); after it, the template report is used.
    LLM_JOB_LIMIT_S: float = 120.0
    # How Bangla reports are written: "direct" (the model writes Bangla), "translate" (English
    # first, then the patient text translated and checked again) or "template" (no model).
    LLM_BN_STRATEGY: str = "direct"
    # A report requested by the questionnaire waits up to this long for its session to end, so
    # its facts include the session's end (duration, next session's plan).
    FEEDBACK_SESSION_END_WAIT_S: float = 10.0

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
    def safety_notices_path(self) -> Path:
        if self.SAFETY_NOTICES_PATH:
            return Path(self.SAFETY_NOTICES_PATH)
        return SERVER_DIR.parent / "shared" / "safety-notices.json"

    @property
    def llm_candidates(self) -> list[str]:
        return [name.strip() for name in self.LLM_MODELS_CANDIDATES.split(",") if name.strip()]

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]


#: Values from .env.example and the tests: never acceptable in production.
DEFAULT_ADMIN_PASSWORDS = {
    "replace-with-a-strong-password", "admin", "password", "changeme", "test-password",
    "e2e-admin-password",
}
MIN_ADMIN_PASSWORD = 12
MIN_JWT_SECRET = 32


def production_problems(config: "Settings") -> list[str]:
    """Why these settings must not run in production (empty when they may). With
    APP_ENV=production the server refuses to start until every problem is fixed."""
    if config.APP_ENV != "production":
        return []
    problems = []
    if config.ADMIN_PASSWORD in DEFAULT_ADMIN_PASSWORDS or len(config.ADMIN_PASSWORD) < MIN_ADMIN_PASSWORD:
        problems.append(f"ADMIN_PASSWORD is a default or shorter than {MIN_ADMIN_PASSWORD} characters")
    secret = config.JWT_SECRET
    if "replace" in secret.lower() or len(secret) < MIN_JWT_SECRET or len(set(secret)) < 10:
        problems.append(f"JWT_SECRET is a placeholder or shorter than {MIN_JWT_SECRET} characters")
    if config.LLM_PROVIDER not in {"ollama", "mock"}:
        problems.append("LLM_PROVIDER must be ollama or mock")
    return problems


settings = Settings()
