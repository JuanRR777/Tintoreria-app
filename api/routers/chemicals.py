from fastapi import APIRouter, HTTPException, Depends, Header, Query
from typing import Optional

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from schemas.chemical import ChemicalCreate, ChemicalUpdate, LotCreate, StockAdjustment
from database.connection import get_db, rows_to_list, row_to_dict, generate_code
from routers.auth import get_current_user
from services import sync_service

router = APIRouter(prefix="/chemicals", tags=["chemicals"])


@router.get("")
def list_chemicals(
    search:        Optional[str]  = Query(None),
    chemical_type: Optional[str]  = Query(None),
    low_stock:     Optional[bool] = Query(None),
    procurement_status: Optional[str] = Query(None),
    current_user:  dict           = Depends(get_current_user),
):
    query = """
        SELECT c.*, u.username AS created_by_name
        FROM chemicals c
        LEFT JOIN users u ON c.created_by = u.id
        WHERE c.deleted_at IS NULL AND c.is_active = 1
    """
    params: list = []

    if search:
        query += " AND (c.name LIKE ? OR c.code LIKE ? OR c.supplier LIKE ?)"
        params += [f"%{search}%", f"%{search}%", f"%{search}%"]
    if chemical_type:
        query += " AND c.chemical_type = ?"
        params.append(chemical_type)
    if low_stock:
        query += " AND c.stock_quantity <= c.min_stock_alert"
    if procurement_status:
        query += " AND c.procurement_status = ?"
        params.append(procurement_status)

    query += " ORDER BY CASE c.procurement_status WHEN 'espera' THEN 0 WHEN 'pedido' THEN 1 ELSE 2 END, c.name"

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return rows_to_list(rows)


@router.get("/{chemical_id}")
def get_chemical(chemical_id: int, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute(
            """SELECT c.*, u.username AS created_by_name
               FROM chemicals c
               LEFT JOIN users u ON c.created_by = u.id
               WHERE c.id = ? AND c.deleted_at IS NULL""",
            (chemical_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Quimico no encontrado")
    return row_to_dict(row)


@router.post("", status_code=201)
def create_chemical(req: ChemicalCreate, current_user: dict = Depends(get_current_user)):
    code = req.code or generate_code("chemical")

    with get_db() as conn:
        if conn.execute("SELECT id FROM chemicals WHERE code = ?", (code,)).fetchone():
            raise HTTPException(status_code=409, detail=f"El codigo '{code}' ya existe")

        conn.execute(
            """INSERT INTO chemicals
               (name, code, chemical_type, unit, density_g_ml, min_stock_alert, max_stock,
                location, supplier, cas_number, is_hazardous, safety_notes, notes, created_by)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                req.name, code, req.chemical_type, req.unit, req.density_g_ml,
                req.min_stock_alert, req.max_stock, req.location, req.supplier,
                req.cas_number, req.is_hazardous, req.safety_notes, req.notes,
                current_user["id"],
            ),
        )
        chem_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        row = conn.execute("SELECT * FROM chemicals WHERE id = ?", (chem_id,)).fetchone()

    chem = row_to_dict(row)
    sync_service.enqueue("chemical", chem_id, "create", chem)
    return chem


@router.put("/{chemical_id}")
def update_chemical(chemical_id: int, req: ChemicalUpdate, current_user: dict = Depends(get_current_user)):
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No hay campos para actualizar")

    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [chemical_id]

    with get_db() as conn:
        conn.execute(
            f"UPDATE chemicals SET {set_clause}, updated_at = datetime('now') WHERE id = ? AND deleted_at IS NULL",
            values,
        )
        row = conn.execute("SELECT * FROM chemicals WHERE id = ?", (chemical_id,)).fetchone()

    chem = row_to_dict(row)
    sync_service.enqueue("chemical", chemical_id, "update", chem)
    return chem


@router.delete("/{chemical_id}")
def delete_chemical(chemical_id: int, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute(
            "SELECT id FROM chemicals WHERE id = ? AND deleted_at IS NULL", (chemical_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Quimico no encontrado")
        conn.execute(
            "UPDATE chemicals SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
            (chemical_id,),
        )
    sync_service.enqueue("chemical", chemical_id, "delete", {"id": chemical_id})
    return {"message": "Quimico eliminado"}


# ---------------------------------------------------------------------------
# Lotes de quimico
# ---------------------------------------------------------------------------

@router.get("/{chemical_id}/lots")
def list_lots(chemical_id: int, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM chemical_lots WHERE chemical_id = ? ORDER BY created_at DESC",
            (chemical_id,),
        ).fetchall()
    return rows_to_list(rows)


@router.post("/{chemical_id}/lots", status_code=201)
def add_lot(chemical_id: int, req: LotCreate, current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        chem = conn.execute(
            "SELECT id, unit FROM chemicals WHERE id = ? AND deleted_at IS NULL", (chemical_id,)
        ).fetchone()
        if not chem:
            raise HTTPException(status_code=404, detail="Quimico no encontrado")

        conn.execute(
            """INSERT INTO chemical_lots
               (chemical_id, lot_number, quantity_received, quantity_remaining, unit,
                purchase_date, expiry_date, unit_cost, supplier, notes)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (
                chemical_id, req.lot_number, req.quantity_received, req.quantity_received,
                req.unit, req.purchase_date, req.expiry_date, req.unit_cost,
                req.supplier, req.notes,
            ),
        )
        lot_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]

        # Actualizar stock total del quimico
        conn.execute(
            "UPDATE chemicals SET stock_quantity = stock_quantity + ?, updated_at = datetime('now') WHERE id = ?",
            (req.quantity_received, chemical_id),
        )

        # Registrar movimiento de entrada
        conn.execute(
            """INSERT INTO stock_movements
               (chemical_id, lot_id, movement_type, quantity, unit, reference_type, notes, user_id)
               VALUES (?,?,'in',?,?,'lot_receipt',?,?)""",
            (chemical_id, lot_id, req.quantity_received, req.unit,
             f"Recepcion lote {req.lot_number}", current_user["id"]),
        )

        row = conn.execute("SELECT * FROM chemical_lots WHERE id = ?", (lot_id,)).fetchone()

    return row_to_dict(row)


# ---------------------------------------------------------------------------
# Historial de movimientos
# ---------------------------------------------------------------------------

@router.get("/{chemical_id}/movements")
def list_movements(
    chemical_id: int,
    limit: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
):
    with get_db() as conn:
        rows = conn.execute(
            """SELECT sm.*, u.full_name AS user_name
               FROM stock_movements sm
               LEFT JOIN users u ON sm.user_id = u.id
               WHERE sm.chemical_id = ?
               ORDER BY sm.created_at DESC
               LIMIT ?""",
            (chemical_id, limit),
        ).fetchall()
    return rows_to_list(rows)
