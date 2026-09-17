"""
Servicio de sincronizacion con la capa web (Cloudflare Workers + D1).

Flujo:
  1. Cada operacion importante (create/update/delete) encola un registro en sync_queue.
  2. Este servicio corre en un hilo de fondo y cada SYNC_INTERVAL_SEC segundos
     toma los registros pendientes y los envia al Workers API.
  3. Si falla, incrementa `attempts`. Despues de SYNC_MAX_ATTEMPTS se marca error.
  4. El endpoint GET /sync/status permite consultar el estado desde la UI.

Para activar el sync, configurar las variables de entorno:
  SYNC_API_URL = https://api.tu-worker.workers.dev
  SYNC_API_KEY = tu-api-key-secreta
"""

import json
import logging
import threading
import time
from typing import Optional

import httpx

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from config import (
    SYNC_API_URL,
    SYNC_API_KEY,
    SYNC_ENABLED,
    SYNC_INTERVAL_SEC,
    SYNC_MAX_ATTEMPTS,
)
from database.connection import get_db, rows_to_list

logger = logging.getLogger(__name__)
_stop_event = threading.Event()


def enqueue(entity_type: str, entity_id: int, operation: str, payload: dict) -> None:
    """No-op: D1 es la fuente de verdad, no hay cola local de sync."""
    return


def _process_batch() -> None:
    """Procesa un lote de registros pendientes y los envia al Workers API."""
    with get_db() as conn:
        rows = rows_to_list(
            conn.execute(
                """SELECT * FROM sync_queue
                   WHERE status = 'pending' AND attempts < ?
                   ORDER BY created_at
                   LIMIT 50""",
                (SYNC_MAX_ATTEMPTS,),
            ).fetchall()
        )

    if not rows:
        return

    headers = {
        "Authorization": f"Bearer {SYNC_API_KEY}",
        "Content-Type": "application/json",
    }

    for item in rows:
        try:
            resp = httpx.post(
                f"{SYNC_API_URL}/sync/ingest",
                headers=headers,
                json={
                    "entity_type": item["entity_type"],
                    "entity_id": item["entity_id"],
                    "operation": item["operation"],
                    "payload": json.loads(item["payload"]),
                },
                timeout=15,
            )
            resp.raise_for_status()

            with get_db() as conn:
                conn.execute(
                    """UPDATE sync_queue
                       SET status = 'sent', attempts = attempts + 1,
                           last_attempt_at = datetime('now'), error_message = NULL
                       WHERE id = ?""",
                    (item["id"],),
                )
        except Exception as exc:
            error_msg = str(exc)[:500]
            with get_db() as conn:
                conn.execute(
                    """UPDATE sync_queue
                       SET attempts = attempts + 1,
                           last_attempt_at = datetime('now'),
                           error_message = ?,
                           status = CASE WHEN attempts + 1 >= ? THEN 'error' ELSE 'pending' END
                       WHERE id = ?""",
                    (error_msg, SYNC_MAX_ATTEMPTS, item["id"]),
                )
            logger.warning("Sync error para item %s: %s", item["id"], error_msg)


def _sync_loop() -> None:
    logger.info("Sync worker iniciado (intervalo: %ss, destino: %s)", SYNC_INTERVAL_SEC, SYNC_API_URL)
    while not _stop_event.is_set():
        try:
            _process_batch()
        except Exception as exc:
            logger.error("Error en sync loop: %s", exc)
        _stop_event.wait(SYNC_INTERVAL_SEC)
    logger.info("Sync worker detenido")


def start_sync_worker() -> Optional[threading.Thread]:
    """Inicia el hilo de sincronizacion si SYNC_ENABLED es True."""
    if not SYNC_ENABLED:
        logger.info("Sync desactivado (SYNC_API_URL y/o SYNC_API_KEY no configurados)")
        return None

    _stop_event.clear()
    thread = threading.Thread(target=_sync_loop, daemon=True, name="sync-worker")
    thread.start()
    return thread


def stop_sync_worker() -> None:
    _stop_event.set()


def get_queue_summary() -> dict:
    return {
        "pending": 0,
        "sent": 0,
        "error": 0,
        "total": 0,
        "sync_enabled": False,
        "enabled": False,
        "backend": "d1",
    }
