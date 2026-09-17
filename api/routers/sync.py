from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from typing import Optional

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from database.connection import get_db, rows_to_list
from routers.auth import get_current_user
from services import sync_service
from config import SYNC_ENABLED

router = APIRouter(prefix="/sync", tags=["sync"])


@router.get("/status")
def sync_status(current_user: dict = Depends(get_current_user)):
    """Estado actual de la cola de sincronizacion con la capa web."""
    return sync_service.get_queue_summary()


@router.get("/queue")
def sync_queue(
    status: Optional[str] = None,
    limit:  int = 50,
    current_user: dict = Depends(get_current_user),
):
    """D1 es la base primaria; no hay cola local."""
    return []


@router.post("/retry-errors")
def retry_errors(current_user: dict = Depends(get_current_user)):
    """Reintenta todos los items marcados como error."""
    if not SYNC_ENABLED:
        raise HTTPException(status_code=503, detail="Sync no configurado")

    with get_db() as conn:
        result = conn.execute(
            "UPDATE sync_queue SET status = 'pending', attempts = 0, error_message = NULL WHERE status = 'error'"
        )
        updated = result.rowcount

    return {"message": f"{updated} items reestablecidos para reintento"}


@router.post("/push-now")
def push_now(background_tasks: BackgroundTasks, current_user: dict = Depends(get_current_user)):
    """Dispara el sync de forma manual en background."""
    if not SYNC_ENABLED:
        raise HTTPException(status_code=503, detail="Sync no configurado: define SYNC_API_URL y SYNC_API_KEY")

    background_tasks.add_task(sync_service._process_batch)
    return {"message": "Sincronizacion iniciada en background"}
