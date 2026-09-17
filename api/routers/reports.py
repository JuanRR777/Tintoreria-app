from datetime import date, timedelta
from fastapi import APIRouter, Depends, Query
from typing import Optional

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from database.connection import get_db, rows_to_list
from routers.auth import get_current_user

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/consumption")
def chemical_consumption(
    from_date:   Optional[str] = Query(None),
    to_date:     Optional[str] = Query(None),
    chemical_id: Optional[int] = Query(None),
    current_user: dict = Depends(get_current_user),
):
    """Consumo de quimicos agrupado por dia y quimico."""
    query = """
        SELECT
            DATE(sm.created_at) AS date,
            c.id                AS chemical_id,
            c.name              AS chemical_name,
            c.code              AS chemical_code,
            c.unit,
            SUM(sm.quantity)    AS total_consumed,
            COUNT(sm.id)        AS movement_count
        FROM stock_movements sm
        JOIN chemicals c ON sm.chemical_id = c.id
        WHERE sm.movement_type = 'out'
    """
    params: list = []

    if from_date:
        query += " AND DATE(sm.created_at) >= ?"
        params.append(from_date)
    if to_date:
        query += " AND DATE(sm.created_at) <= ?"
        params.append(to_date)
    if chemical_id:
        query += " AND sm.chemical_id = ?"
        params.append(chemical_id)

    query += " GROUP BY DATE(sm.created_at), c.id ORDER BY date DESC, total_consumed DESC"

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return rows_to_list(rows)


@router.get("/processes")
def process_history(
    from_date: Optional[str] = Query(None),
    to_date:   Optional[str] = Query(None),
    status:    Optional[str] = Query(None),
    limit:     int           = Query(100, ge=1, le=500),
    current_user: dict = Depends(get_current_user),
):
    """Historial de procesos con totales de ingredientes consumidos."""
    query = """
        SELECT
            p.id,
            p.batch_number,
            p.fiber_weight_kg,
            p.water_volume_liters,
            p.status,
            p.quality_score,
            p.started_at,
            p.completed_at,
            p.total_time_min,
            r.code   AS recipe_code,
            r.name   AS recipe_name,
            m.name   AS machine_name,
            u.full_name AS operator_name,
            p.created_at
        FROM processes p
        JOIN recipes r ON p.recipe_id = r.id
        LEFT JOIN machines m ON p.machine_id = m.id
        JOIN users u ON p.operator_id = u.id
        WHERE 1=1
    """
    params: list = []

    if from_date:
        query += " AND DATE(p.created_at) >= ?"
        params.append(from_date)
    if to_date:
        query += " AND DATE(p.created_at) <= ?"
        params.append(to_date)
    if status:
        query += " AND p.status = ?"
        params.append(status)

    query += " ORDER BY p.created_at DESC LIMIT ?"
    params.append(limit)

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()
    return rows_to_list(rows)


@router.get("/processes/{process_id}/weighings-summary")
def process_weighings_summary(process_id: int, current_user: dict = Depends(get_current_user)):
    """Resumen de pesajes de un proceso: esperado vs real, variaciones."""
    with get_db() as conn:
        rows = conn.execute(
            """SELECT
                 pw.id,
                 c.name              AS chemical_name,
                 c.code              AS chemical_code,
                 pw.expected_quantity,
                 pw.actual_quantity,
                 pw.unit,
                 pw.variance_percentage,
                 pw.is_within_tolerance,
                 pw.status,
                 pw.weighed_at
               FROM process_weighings pw
               JOIN chemicals c ON pw.chemical_id = c.id
               WHERE pw.process_id = ?
               ORDER BY pw.id""",
            (process_id,),
        ).fetchall()
    return rows_to_list(rows)


@router.get("/dashboard")
def dashboard_kpis(current_user: dict = Depends(get_current_user)):
    """KPIs y series para el resumen con graficas."""
    with get_db() as conn:
        row = conn.execute(
            """SELECT
                 COUNT(*) AS chemicals_total,
                 SUM(CASE WHEN stock_quantity <= min_stock_alert THEN 1 ELSE 0 END) AS low_stock_count,
                 SUM(CASE WHEN stock_quantity = 0 THEN 1 ELSE 0 END) AS out_of_stock_count,
                 SUM(CASE WHEN procurement_status = 'espera' THEN 1 ELSE 0 END) AS waiting_count,
                 SUM(CASE WHEN procurement_status = 'pedido' THEN 1 ELSE 0 END) AS ordered_count,
                 SUM(CASE WHEN procurement_status NOT IN ('espera', 'pedido') THEN 1 ELSE 0 END) AS available_count,
                 COALESCE(SUM(CASE WHEN stock_quantity > 0 THEN stock_quantity ELSE 0 END), 0) AS stock_kg
               FROM chemicals
               WHERE is_active = 1 AND deleted_at IS NULL"""
        ).fetchone()
        totals = dict(row) if row else {}

        active_processes = conn.execute(
            "SELECT COUNT(*) FROM processes WHERE status IN ('pending','in_progress','paused')"
        ).fetchone()[0]

        completed_this_month = conn.execute(
            "SELECT COUNT(*) FROM processes WHERE status = 'completed' AND strftime('%Y-%m', completed_at) = strftime('%Y-%m', 'now')"
        ).fetchone()[0]

        recipes_count = conn.execute(
            "SELECT COUNT(*) FROM recipes WHERE is_active = 1 AND deleted_at IS NULL"
        ).fetchone()[0]

        recent_processes = rows_to_list(
            conn.execute(
                """SELECT p.batch_number, p.status, p.fiber_weight_kg,
                          r.name AS recipe_name, p.created_at
                   FROM processes p JOIN recipes r ON p.recipe_id = r.id
                   ORDER BY p.created_at DESC LIMIT 6"""
            ).fetchall()
        )

        consumption_last_7d = rows_to_list(
            conn.execute(
                """SELECT c.name, c.unit, SUM(sm.quantity) AS total
                   FROM stock_movements sm JOIN chemicals c ON sm.chemical_id = c.id
                   WHERE sm.movement_type = 'out'
                     AND sm.created_at >= datetime('now', '-7 days')
                   GROUP BY c.id ORDER BY total DESC LIMIT 8"""
            ).fetchall()
        )

        procurement = rows_to_list(
            conn.execute(
                """SELECT procurement_status AS status, COUNT(*) AS count
                   FROM chemicals
                   WHERE is_active = 1 AND deleted_at IS NULL
                   GROUP BY procurement_status"""
            ).fetchall()
        )

        chemical_types = rows_to_list(
            conn.execute(
                """SELECT chemical_type AS type, COUNT(*) AS count
                   FROM chemicals
                   WHERE is_active = 1 AND deleted_at IS NULL
                   GROUP BY chemical_type
                   ORDER BY count DESC"""
            ).fetchall()
        )

        movement_rows = rows_to_list(
            conn.execute(
                """SELECT DATE(created_at) AS date,
                          COALESCE(SUM(CASE WHEN movement_type = 'in' THEN quantity ELSE 0 END), 0) AS qty_in,
                          COALESCE(SUM(CASE WHEN movement_type = 'out' THEN quantity ELSE 0 END), 0) AS qty_out
                   FROM stock_movements
                   WHERE created_at >= datetime('now', '-14 days')
                   GROUP BY DATE(created_at)
                   ORDER BY date"""
            ).fetchall()
        )

    return {
        "chemicals_total":      int(totals.get("chemicals_total") or 0),
        "low_stock_count":      int(totals.get("low_stock_count") or 0),
        "out_of_stock_count":   int(totals.get("out_of_stock_count") or 0),
        "waiting_count":        int(totals.get("waiting_count") or 0),
        "ordered_count":        int(totals.get("ordered_count") or 0),
        "available_count":      int(totals.get("available_count") or 0),
        "stock_kg":             float(totals.get("stock_kg") or 0),
        "active_processes":     int(active_processes or 0),
        "completed_this_month": int(completed_this_month or 0),
        "recipes_count":        int(recipes_count or 0),
        "recent_processes":     recent_processes,
        "top_consumption_7d":   consumption_last_7d,
        "procurement":          procurement,
        "chemical_types":       chemical_types,
        "movements_14d":        _fill_movement_days(movement_rows, 14),
    }


def _fill_movement_days(rows: list[dict], days: int) -> list[dict]:
    by = {}
    for row in rows or []:
        key = str(row.get("date") or "")[:10]
        if key:
            by[key] = row
    today = date.today()
    series = []
    for offset in range(days - 1, -1, -1):
        day = today - timedelta(days=offset)
        key = day.isoformat()
        hit = by.get(key) or {}
        series.append({
            "date": key,
            "label": day.strftime("%d/%m"),
            "qty_in": float(hit.get("qty_in") or 0),
            "qty_out": float(hit.get("qty_out") or 0),
        })
    return series
