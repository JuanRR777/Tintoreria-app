from fastapi import APIRouter, Depends, Query
from typing import Optional

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from database.connection import get_db, rows_to_list
from routers.auth import get_current_user
from services.chemical_type import reclassify_otros
from services.inventory_sync import WAREHOUSE, apply_open_receipts

router = APIRouter(prefix="/stock", tags=["stock"])


def _item_key(value) -> str:
    raw = str(value or "").strip()
    stripped = raw.lstrip("0")
    return stripped or raw


def _occ_still_open(row: dict) -> bool:
    """Queda en tránsito si aún falta cantidad pedida, aunque ya haya entrada parcial."""
    ordered = float(row.get("qty_ordered") or 0)
    entered = float(row.get("qty_entered") or 0)
    pending = float(row.get("qty_pending") or 0)
    if ordered > 0:
        return entered + 1e-6 < ordered
    return pending > 1e-6


def _open_occ_keys(rows: list) -> set[str]:
    keys: set[str] = set()
    for row in rows:
        if not _occ_still_open(row):
            continue
        key = _item_key(row.get("item_code"))
        if key:
            keys.add(key)
    return keys


def _occ_line_rows(conn) -> list:
    return rows_to_list(
        conn.execute(
            """SELECT item_code, occ_number, created_at, id,
                      inventory_applied, qty_ordered, qty_entered, qty_pending
               FROM purchase_order_lines
               WHERE warehouse = ?""",
            (WAREHOUSE,),
        ).fetchall()
    )


def _attach_occ_numbers(items: list, rows: Optional[list] = None) -> list:
    """Cruza tránsito con OCC en Python: D1 no resuelve bien subconsultas correlacionadas."""
    if not items or not rows:
        return items

    latest: dict = {}
    counts: dict[str, set] = {}
    totals: dict[str, dict] = {}
    for row in rows:
        code = _item_key(row.get("item_code"))
        occ = str(row.get("occ_number") or "").strip()
        if not code or not occ:
            continue
        open_line = _occ_still_open(row)
        stamp = (str(row.get("created_at") or ""), int(row.get("id") or 0))
        qty_ordered = float(row.get("qty_ordered") or 0)
        qty_entered = float(row.get("qty_entered") or 0)
        qty_pending = float(row.get("qty_pending") or 0)
        prev = latest.get(code)
        if prev is None or (open_line and not prev["open"]) or (
            open_line == prev["open"] and stamp > prev["stamp"]
        ):
            latest[code] = {
                "occ": occ,
                "open": open_line,
                "stamp": stamp,
                "qty_ordered": qty_ordered,
                "qty_entered": qty_entered,
                "qty_pending": qty_pending,
            }
        if open_line:
            counts.setdefault(code, set()).add(occ)
            acc = totals.setdefault(code, {"qty_ordered": 0.0, "qty_entered": 0.0, "qty_pending": 0.0})
            acc["qty_ordered"] += qty_ordered
            acc["qty_entered"] += qty_entered
            acc["qty_pending"] += qty_pending

    for item in items:
        if (item.get("procurement_status") or "") == "espera":
            continue
        code = _item_key(item.get("code"))
        hit = latest.get(code)
        if not hit:
            continue
        acc = totals.get(code) or hit
        item["occ_number"] = hit["occ"]
        item["occ_count"] = len(counts.get(code) or {hit["occ"]})
        item["qty_ordered"] = acc["qty_ordered"]
        item["qty_entered"] = acc["qty_entered"]
        item["qty_pending"] = acc["qty_pending"]
    return items


def _pending_purchase(conn) -> list:
    """Espera (SOC) más OCC con cantidad pendiente, aunque el químico ya tenga stock."""
    occ_rows = _occ_line_rows(conn)
    open_keys = _open_occ_keys(occ_rows)
    items = rows_to_list(
        conn.execute(
            """SELECT id, name, code, unit, procurement_status, pending_qty,
                      supplier, last_unit_price, last_unit_currency, stock_quantity
               FROM chemicals
               WHERE is_active = 1 AND deleted_at IS NULL
               ORDER BY CASE procurement_status WHEN 'espera' THEN 0 WHEN 'pedido' THEN 1 ELSE 2 END, name""",
        ).fetchall()
    )
    pending = []
    for item in items:
        status = (item.get("procurement_status") or "").lower()
        key = _item_key(item.get("code"))
        if status == "espera" or key in open_keys:
            pending.append(item)
    return _attach_occ_numbers(pending, occ_rows)


@router.get("/summary")
def stock_summary(current_user: dict = Depends(get_current_user)):
    """Resumen de inventario: total de quimicos, alertas de stock bajo y proximos a vencer."""
    with get_db() as conn:
        apply_open_receipts(conn, current_user.get("id"))
        reclassify_otros(conn)
        totals = dict(
            conn.execute(
                """SELECT
                     COUNT(*) AS total_chemicals,
                     SUM(CASE WHEN stock_quantity <= min_stock_alert THEN 1 ELSE 0 END) AS low_stock_count,
                     SUM(CASE WHEN stock_quantity = 0 THEN 1 ELSE 0 END) AS out_of_stock_count,
                     SUM(CASE WHEN procurement_status = 'espera' THEN 1 ELSE 0 END) AS waiting_count,
                     SUM(CASE WHEN procurement_status = 'pedido' THEN 1 ELSE 0 END) AS ordered_count
                   FROM chemicals
                   WHERE is_active = 1 AND deleted_at IS NULL"""
            ).fetchone()
        )

        low_stock = rows_to_list(
            conn.execute(
                """SELECT id, name, code, chemical_type, stock_quantity, min_stock_alert, unit
                   FROM chemicals
                   WHERE is_active = 1 AND deleted_at IS NULL
                     AND stock_quantity <= min_stock_alert
                   ORDER BY (stock_quantity - min_stock_alert)""",
            ).fetchall()
        )

        expiring_lots = rows_to_list(
            conn.execute(
                """SELECT cl.*, c.name AS chemical_name, c.code AS chemical_code
                   FROM chemical_lots cl
                   JOIN chemicals c ON cl.chemical_id = c.id
                   WHERE cl.status = 'active'
                     AND cl.expiry_date IS NOT NULL
                     AND cl.expiry_date <= date('now', '+30 days')
                   ORDER BY cl.expiry_date""",
            ).fetchall()
        )

        pending_purchase = _pending_purchase(conn)
        totals["ordered_count"] = sum(
            1 for item in pending_purchase
            if (item.get("procurement_status") or "") != "espera"
        )

    return {
        **totals,
        "low_stock_chemicals": low_stock,
        "expiring_lots_30d":   expiring_lots,
        "pending_purchase":    pending_purchase,
    }


@router.get("/movements")
def list_all_movements(
    chemical_id:     Optional[int]  = Query(None),
    movement_type:   Optional[str]  = Query(None),
    from_date:       Optional[str]  = Query(None),
    to_date:         Optional[str]  = Query(None),
    limit:           int            = Query(100, ge=1, le=500),
    current_user: dict = Depends(get_current_user),
):
    query = """
        SELECT sm.*, c.name AS chemical_name, c.code AS chemical_code,
               u.full_name AS user_name, cl.lot_number
        FROM stock_movements sm
        JOIN chemicals c ON sm.chemical_id = c.id
        LEFT JOIN users u ON sm.user_id = u.id
        LEFT JOIN chemical_lots cl ON sm.lot_id = cl.id
        WHERE 1=1
    """
    params: list = []

    if chemical_id:
        query += " AND sm.chemical_id = ?"
        params.append(chemical_id)
    if movement_type:
        query += " AND sm.movement_type = ?"
        params.append(movement_type)
    if from_date:
        query += " AND DATE(sm.created_at) >= ?"
        params.append(from_date)
    if to_date:
        query += " AND DATE(sm.created_at) <= ?"
        params.append(to_date)

    query += " ORDER BY sm.created_at DESC LIMIT ?"
    params.append(limit)

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return rows_to_list(rows)
