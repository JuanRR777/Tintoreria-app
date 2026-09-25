from fastapi import APIRouter, HTTPException, Depends, WebSocket, WebSocketDisconnect
from typing import Optional

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from schemas.machine import MachineCreate, MachineUpdate, ScaleCreate, ScaleUpdate
from database.connection import get_db, rows_to_list, row_to_dict, generate_code, ensure_machines_schema
from routers.auth import get_current_user
from services import scale_service


def decorate_machine(row: dict | None) -> dict | None:
    if not row:
        return row
    cap = float(row.get("capacity_kg") or 0)
    water = float(row.get("water_capacity_liters") or 0)
    row["bath_ratio_l_per_kg"] = round(water / cap, 1) if cap > 0 and water > 0 else None
    return row

router = APIRouter(tags=["machines"])


# ---------------------------------------------------------------------------
# Maquinas
# ---------------------------------------------------------------------------

@router.get("/machines")
def list_machines(current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        ensure_machines_schema(conn)
        rows = conn.execute(
            "SELECT * FROM machines ORDER BY code"
        ).fetchall()
    return [decorate_machine(r) for r in rows_to_list(rows)]


@router.get("/machines/{machine_id}")
def get_machine(machine_id: int, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        ensure_machines_schema(conn)
        row = conn.execute("SELECT * FROM machines WHERE id = ?", (machine_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Maquina no encontrada")
    return decorate_machine(row_to_dict(row))


@router.post("/machines", status_code=201)
def create_machine(req: MachineCreate, current_user: dict = Depends(get_current_user)):
    ensure_machines_schema()
    code = (req.code or "").strip() or generate_code("machine")
    with get_db() as conn:
        if conn.execute("SELECT id FROM machines WHERE code = ?", (code,)).fetchone():
            raise HTTPException(status_code=409, detail=f"El codigo '{code}' ya existe")
        conn.execute(
            """INSERT INTO machines
               (name, code, machine_type, equipment_type, dye_format, capacity_kg,
                water_capacity_liters, manufacture_year, status,
                manufacturer, model, serial_number, installation_date, last_maintenance,
                next_maintenance_due, description, notes)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                req.name, code, req.machine_type, req.equipment_type, req.dye_format,
                req.capacity_kg, req.water_capacity_liters, req.manufacture_year,
                req.status, req.manufacturer, req.model, req.serial_number,
                req.installation_date, req.last_maintenance, req.next_maintenance_due,
                req.description, req.notes,
            ),
        )
        machine_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        row = conn.execute("SELECT * FROM machines WHERE id = ?", (machine_id,)).fetchone()
    return decorate_machine(row_to_dict(row))


@router.put("/machines/{machine_id}")
def update_machine(machine_id: int, req: MachineUpdate, current_user: dict = Depends(get_current_user)):
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No hay campos para actualizar")

    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [machine_id]

    with get_db() as conn:
        ensure_machines_schema(conn)
        conn.execute(
            f"UPDATE machines SET {set_clause}, updated_at = datetime('now') WHERE id = ?",
            values,
        )
        row = conn.execute("SELECT * FROM machines WHERE id = ?", (machine_id,)).fetchone()
    return decorate_machine(row_to_dict(row))


@router.delete("/machines/{machine_id}")
def delete_machine(machine_id: int, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        in_use = conn.execute(
            "SELECT id FROM processes WHERE machine_id = ? AND status IN ('in_progress','paused')",
            (machine_id,),
        ).fetchone()
        if in_use:
            raise HTTPException(status_code=409, detail="La maquina tiene procesos activos")
        conn.execute("DELETE FROM machines WHERE id = ?", (machine_id,))
    return {"message": "Maquina eliminada"}


# ---------------------------------------------------------------------------
# Basculas
# ---------------------------------------------------------------------------

@router.get("/scales")
def list_scales(current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM scales ORDER BY name").fetchall()
    return rows_to_list(rows)


@router.get("/scales/ports")
def list_ports(current_user: dict = Depends(get_current_user)):
    """Retorna los puertos seriales disponibles en el sistema."""
    return scale_service.list_ports()


@router.get("/scales/{scale_id}")
def get_scale(scale_id: int, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM scales WHERE id = ?", (scale_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Bascula no encontrada")
    return row_to_dict(row)


@router.post("/scales", status_code=201)
def create_scale(req: ScaleCreate, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        if conn.execute("SELECT id FROM scales WHERE identifier = ?", (req.identifier,)).fetchone():
            raise HTTPException(status_code=409, detail="El identificador ya existe")
        conn.execute(
            """INSERT INTO scales
               (name, identifier, port, baud_rate, data_bits, parity, stop_bits,
                protocol, unit, precision_decimals, max_weight, notes)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                req.name, req.identifier, req.port, req.baud_rate, req.data_bits,
                req.parity, req.stop_bits, req.protocol, req.unit,
                req.precision_decimals, req.max_weight, req.notes,
            ),
        )
        scale_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        row = conn.execute("SELECT * FROM scales WHERE id = ?", (scale_id,)).fetchone()
    return row_to_dict(row)


@router.put("/scales/{scale_id}")
def update_scale(scale_id: int, req: ScaleUpdate, current_user: dict = Depends(get_current_user)):
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No hay campos para actualizar")

    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [scale_id]

    with get_db() as conn:
        conn.execute(
            f"UPDATE scales SET {set_clause}, updated_at = datetime('now') WHERE id = ?",
            values,
        )
        row = conn.execute("SELECT * FROM scales WHERE id = ?", (scale_id,)).fetchone()
    return row_to_dict(row)


@router.delete("/scales/{scale_id}")
def delete_scale(scale_id: int, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        conn.execute("DELETE FROM scales WHERE id = ?", (scale_id,))
    return {"message": "Bascula eliminada"}


# ---------------------------------------------------------------------------
# WebSocket: stream de peso en tiempo real
# ---------------------------------------------------------------------------

@router.websocket("/ws/scales/{scale_id}/stream")
async def scale_stream(websocket: WebSocket, scale_id: int):
    """
    Stream en tiempo real desde la bascula via WebSocket.
    El cliente puede enviar el token JWT como primer mensaje para autenticarse.
    Emite: {"weight": float, "raw": str, "stable": bool, "unit": str}
    """
    await websocket.accept()

    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM scales WHERE id = ? AND is_active = 1", (scale_id,)
        ).fetchone()

    if not row:
        await websocket.close(code=4004, reason="Bascula no encontrada o inactiva")
        return

    scale = row_to_dict(row)

    if not scale.get("port"):
        await websocket.close(code=4001, reason="La bascula no tiene un puerto configurado")
        return

    try:
        async for reading in scale_service.stream_weight(
            port=scale["port"],
            baud_rate=scale["baud_rate"] or 9600,
            protocol=scale["protocol"] or "generic",
            data_bits=scale["data_bits"] or 8,
            parity=scale["parity"] or "N",
            stop_bits=scale["stop_bits"] or 1,
        ):
            await websocket.send_json({
                "weight":   reading["weight"],
                "raw":      reading["raw"],
                "stable":   reading["stable"],
                "unit":     scale["unit"] or "g",
                "scale_id": scale_id,
            })
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await websocket.send_json({"error": str(exc)})
            await websocket.close()
        except Exception:
            pass
