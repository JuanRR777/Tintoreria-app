from fastapi import APIRouter, HTTPException, Depends, Header, Query
from typing import Optional

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from schemas.chemical import ChemicalCreate, ChemicalUpdate, LotCreate, LotUpdate, StockAdjustment
from database.connection import get_db, rows_to_list, row_to_dict, generate_code, ensure_recipes_schema, ensure_inventory_schema
from routers.auth import get_current_user
from services import sync_service
from services.inventory_sync import migrate_legacy_lot_numbers

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
        SELECT c.*, u.username AS created_by_name,
               (SELECT cl.lot_number
                  FROM chemical_lots cl
                 WHERE cl.chemical_id = c.id
                   AND cl.status = 'active'
                   AND cl.quantity_remaining > 0.0001
                 ORDER BY COALESCE(cl.expiry_date, '9999-12-31') ASC,
                          COALESCE(cl.purchase_date, cl.created_at) ASC,
                          cl.id ASC
                 LIMIT 1) AS current_lot_number,
               (SELECT cl.supplier
                  FROM chemical_lots cl
                 WHERE cl.chemical_id = c.id
                   AND cl.status = 'active'
                   AND cl.quantity_remaining > 0.0001
                 ORDER BY COALESCE(cl.expiry_date, '9999-12-31') ASC,
                          COALESCE(cl.purchase_date, cl.created_at) ASC,
                          cl.id ASC
                 LIMIT 1) AS current_lot_supplier,
               (SELECT COUNT(*)
                  FROM chemical_lots cl
                 WHERE cl.chemical_id = c.id
                   AND cl.status = 'active'
                   AND cl.quantity_remaining > 0.0001) AS active_lot_count
        FROM chemicals c
        LEFT JOIN users u ON c.created_by = u.id
        WHERE c.deleted_at IS NULL AND c.is_active = 1
          AND c.code NOT LIKE 'TMP%'
    """
    params: list = []

    if search:
        query += """ AND (
            c.name LIKE ? OR c.code LIKE ? OR c.supplier LIKE ?
            OR EXISTS (
                SELECT 1 FROM chemical_lots cl
                 WHERE cl.chemical_id = c.id AND cl.lot_number LIKE ?
            )
        )"""
        like = f"%{search}%"
        params += [like, like, like, like]
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
        ensure_recipes_schema(conn)
        ensure_inventory_schema(conn)
        migrate_legacy_lot_numbers(conn)
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
        migrate_legacy_lot_numbers(conn, chemical_id)
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


@router.put("/{chemical_id}/lots/{lot_id}")
def update_lot(
    chemical_id: int,
    lot_id: int,
    req: LotUpdate,
    current_user: dict = Depends(get_current_user),
):
    expiry = (req.expiry_date or "").strip() or None
    with get_db() as conn:
        lot = conn.execute(
            """SELECT id FROM chemical_lots
               WHERE id = ? AND chemical_id = ?""",
            (lot_id, chemical_id),
        ).fetchone()
        if not lot:
            raise HTTPException(status_code=404, detail="Lote no encontrado")

        remaining = conn.execute(
            "SELECT quantity_remaining FROM chemical_lots WHERE id = ?",
            (lot_id,),
        ).fetchone()
        qty_left = float((remaining["quantity_remaining"] if remaining else 0) or 0)
        status = None
        if expiry:
            today = conn.execute("SELECT date('now')").fetchone()[0]
            if expiry < today:
                status = "expired"
            elif qty_left > 0:
                status = "active"

        if status:
            conn.execute(
                """UPDATE chemical_lots
                   SET expiry_date = ?, status = ?, updated_at = datetime('now')
                   WHERE id = ?""",
                (expiry, status, lot_id),
            )
        else:
            conn.execute(
                """UPDATE chemical_lots
                   SET expiry_date = ?, updated_at = datetime('now')
                   WHERE id = ?""",
                (expiry, lot_id),
            )
        row = conn.execute("SELECT * FROM chemical_lots WHERE id = ?", (lot_id,)).fetchone()

    return row_to_dict(row)


@router.post("/{chemical_id}/movements", status_code=201)
def register_movement(chemical_id: int, req: StockAdjustment, current_user: dict = Depends(get_current_user)):
    """Entrada, salida, merma, devolucion o ajuste manual; mueve el stock y el lote si se indica."""
    kind = req.movement_type
    if kind == "adjustment" and req.direction not in ("up", "down"):
        raise HTTPException(status_code=400, detail="Indica si el ajuste suma o resta")
    negative = kind in ("out", "waste") or (kind == "adjustment" and req.direction == "down")
    to_lab = kind == "out" and req.destination == "laboratorio"
    delta = -req.quantity if negative else req.quantity

    with get_db() as conn:
        ensure_inventory_schema(conn)
        chem = conn.execute(
            "SELECT id, unit, stock_quantity FROM chemicals WHERE id = ? AND deleted_at IS NULL",
            (chemical_id,),
        ).fetchone()
        if not chem:
            raise HTTPException(status_code=404, detail="Quimico no encontrado")
        unit = req.unit or chem["unit"] or "kg"
        stock_now = float(chem["stock_quantity"] or 0)
        if negative and req.quantity > stock_now + 1e-6:
            raise HTTPException(status_code=409, detail=f"Solo hay {stock_now:g} {unit} en bodega")

        if req.lot_id:
            lot = conn.execute(
                "SELECT id, quantity_remaining, lab_quantity FROM chemical_lots WHERE id = ? AND chemical_id = ?",
                (req.lot_id, chemical_id),
            ).fetchone()
            if not lot:
                raise HTTPException(status_code=404, detail="Lote no encontrado")
            left = float(lot["quantity_remaining"] or 0)
            if negative and req.quantity > left + 1e-6:
                raise HTTPException(status_code=409, detail=f"El lote solo tiene {left:g} {unit}")
            new_left = max(0.0, left + delta)
            lab_left = float(lot["lab_quantity"] or 0) + (req.quantity if to_lab else 0)
            conn.execute(
                """UPDATE chemical_lots
                   SET quantity_remaining = ?, lab_quantity = ?, status = ?, updated_at = datetime('now')
                   WHERE id = ?""",
                (new_left, lab_left, "active" if new_left > 1e-6 or lab_left > 1e-6 else "depleted", req.lot_id),
            )

        if to_lab:
            conn.execute(
                """UPDATE chemicals
                   SET stock_quantity = MAX(0, stock_quantity + ?),
                       lab_quantity = COALESCE(lab_quantity, 0) + ?,
                       updated_at = datetime('now')
                   WHERE id = ?""",
                (delta, req.quantity, chemical_id),
            )
        else:
            conn.execute(
                "UPDATE chemicals SET stock_quantity = MAX(0, stock_quantity + ?), updated_at = datetime('now') WHERE id = ?",
                (delta, chemical_id),
            )
        conn.execute(
            """INSERT INTO stock_movements
               (chemical_id, lot_id, movement_type, quantity, unit, reference_type, notes, user_id)
               VALUES (?,?,?,?,?,?,?,?)""",
            (
                chemical_id, req.lot_id, kind,
                delta if kind == "adjustment" else req.quantity,
                unit, "laboratorio" if to_lab else "manual",
                (req.notes or "").strip() or None, current_user["id"],
            ),
        )
        row = conn.execute("SELECT * FROM chemicals WHERE id = ?", (chemical_id,)).fetchone()

    chem_row = row_to_dict(row)
    sync_service.enqueue("chemical", chemical_id, "update", chem_row)
    return chem_row


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
            """SELECT sm.*, u.full_name AS user_name, cl.lot_number
               FROM stock_movements sm
               LEFT JOIN users u ON sm.user_id = u.id
               LEFT JOIN chemical_lots cl ON sm.lot_id = cl.id
               WHERE sm.chemical_id = ?
               ORDER BY sm.created_at DESC
               LIMIT ?""",
            (chemical_id, limit),
        ).fetchall()
    return rows_to_list(rows)
