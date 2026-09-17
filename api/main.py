import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

sys.path.insert(0, str(Path(__file__).parent))

from config import API_HOST, API_PORT, CORS_ORIGINS
from database.connection import init_db
from services import sync_service

from routers import auth, chemicals, recipes, processes, machines, stock, reports, sync, requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Inicializando base de datos...")
    init_db()
    logger.info("Base de datos lista")

    sync_thread = sync_service.start_sync_worker()
    if sync_thread:
        logger.info("Sync worker iniciado")

    yield

    # Shutdown
    sync_service.stop_sync_worker()
    logger.info("API detenida")


app = FastAPI(
    title="Tintoreria de Hilos - API Local",
    description="Interfaz local de laboratorio (básculas y JWT) sobre Cloudflare D1.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router)
app.include_router(chemicals.router)
app.include_router(recipes.router)
app.include_router(processes.router)
app.include_router(machines.router)
app.include_router(stock.router)
app.include_router(requests.router)
app.include_router(reports.router)
app.include_router(sync.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "tintoreria-api"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=API_HOST,
        port=API_PORT,
        reload=False,
        log_level="info",
    )
