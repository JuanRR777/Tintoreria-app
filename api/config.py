import os
from pathlib import Path

BASE_DIR = Path(__file__).parent


def _apply_env_file(env_path: Path, *, override: bool) -> None:
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if override:
            os.environ[key] = value
        else:
            os.environ.setdefault(key, value)


def _appdata_env_path() -> Path:
    local = os.getenv("LOCALAPPDATA") or os.path.expanduser("~")
    return Path(local) / "Tintoreria" / ".env"


def _load_dotenv() -> None:
    """Dev: api/.env. Instalado: AppData (Electron pasa TINTORERIA_ENV)."""
    _apply_env_file(BASE_DIR / ".env", override=False)

    appdata = _appdata_env_path()
    if appdata.is_file():
        _apply_env_file(appdata, override=True)

    explicit = (os.getenv("TINTORERIA_ENV") or "").strip()
    if explicit:
        _apply_env_file(Path(explicit), override=True)


_load_dotenv()

# Cloudflare Worker + D1 (fuente de verdad)
WORKER_URL     = os.getenv("WORKER_URL", "").rstrip("/")
WORKER_API_KEY = os.getenv("WORKER_API_KEY", "")

# Servidor API local (Electron / basculas)
API_HOST = os.getenv("API_HOST", "127.0.0.1")
API_PORT = int(os.getenv("API_PORT", "8000"))

# Autenticacion JWT
JWT_SECRET       = os.getenv("JWT_SECRET", "cambiar-este-secreto-en-produccion-2026")
JWT_ALGORITHM    = "HS256"
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "8"))

# Sincronizacion (ya no aplica: D1 es la base primaria)
SYNC_API_URL      = os.getenv("SYNC_API_URL", "")
SYNC_API_KEY      = os.getenv("SYNC_API_KEY", "")
SYNC_ENABLED      = False
SYNC_INTERVAL_SEC = int(os.getenv("SYNC_INTERVAL_SEC", "300"))
SYNC_MAX_ATTEMPTS = int(os.getenv("SYNC_MAX_ATTEMPTS", "3"))

# CORS: origenes permitidos para el renderer de Electron
CORS_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "app://.",
    "file://",
]
