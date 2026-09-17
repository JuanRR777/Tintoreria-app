from datetime import datetime
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from typing import Optional

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from database.connection import get_db, rows_to_list
from routers.auth import get_current_user
from services.csv_import import parse_occ_file, parse_soc_file
from services.inventory_sync import backfill_catalog, sync_from_occ, sync_from_soc

WAREHOUSE = "10502"

router = APIRouter(prefix="/requests", tags=["requests"])


def _sql_bogota(col: str) -> str:
    """Hora de Bogota guardada con o sin offset: usa solo YYYY-MM-DD HH:MM:SS."""
    return f"replace(substr({col}, 1, 19), 'T', ' ')"


def _minutes_sql(start_col: str, end_col: str) -> str:
    return (
        f"CAST((julianday({_sql_bogota(end_col)}) - julianday({_sql_bogota(start_col)})) "
        f"* 1440 AS INTEGER)"
    )


def _soc_select() -> str:
    minutes = _minutes_sql("created_at", "approved_at")
    return f"""
        SELECT
            id, warehouse, soc_number, reference_doc, item_code, item_name,
            detail_ext_1, detail_ext_2, unit, qty_requested, qty_ordered, qty_pending,
            status, created_at, approved_at, requester,
            CASE
                WHEN created_at IS NOT NULL AND approved_at IS NOT NULL THEN {minutes}
                ELSE NULL
            END AS approval_minutes
        FROM purchase_request_lines
        WHERE warehouse = ?
        ORDER BY created_at DESC, soc_number, item_code
    """


def _occ_select() -> str:
    minutes = _minutes_sql("created_at", "approved_at")
    return f"""
        SELECT
            id, warehouse, occ_number, soc_number, soc_raw, reference_doc,
            item_code, item_name, detail_ext_1, detail_ext_2, unit,
            qty_ordered, qty_entered, qty_pending, currency,
            unit_price, gross_value, discount_value, tax_value, net_value,
            status, created_at, approved_at, updated_at, due_days, buyer, supplier,
            inventory_applied,
            CASE
                WHEN qty_ordered > 0 AND qty_entered + 0.0001 >= qty_ordered
                THEN updated_at
                ELSE NULL
            END AS delivered_at,
            CASE
                WHEN created_at IS NOT NULL AND approved_at IS NOT NULL THEN {minutes}
                ELSE NULL
            END AS approval_minutes
        FROM purchase_order_lines
        WHERE warehouse = ?
        ORDER BY created_at DESC, occ_number, item_code
    """


def _parse_dt(value):
    if not value:
        return None
    text = str(value).replace("T", " ")[:19]
    try:
        return datetime.strptime(text, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def _avg_minutes(values) -> float | None:
    nums = []
    for value in values:
        if value is None or value == "":
            continue
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if number >= 0:
            nums.append(number)
    if not nums:
        return None
    return round(sum(nums) / len(nums), 1)


def _summary_from_rows(soc: list[dict], occ: list[dict]) -> dict:
    occ_by_item = {}
    for row in occ:
        key = (row.get("soc_number"), row.get("item_code"))
        if key[0] and key[1] and key not in occ_by_item:
            occ_by_item[key] = row

    link_mins = []
    for row in soc:
        other = occ_by_item.get((row.get("soc_number"), row.get("item_code")))
        if not other:
            continue
        start = _parse_dt(row.get("approved_at"))
        end = _parse_dt(other.get("created_at"))
        if start and end:
            delta = (end - start).total_seconds() / 60
            if delta >= 0:
                link_mins.append(delta)

    return {
        "warehouse": WAREHOUSE,
        "soc_lines": len(soc),
        "occ_lines": len(occ),
        "soc_documents": len({r.get("soc_number") for r in soc if r.get("soc_number")}),
        "occ_documents": len({r.get("occ_number") for r in occ if r.get("occ_number")}),
        "avg_soc_approval_min": _avg_minutes(r.get("approval_minutes") for r in soc),
        "avg_occ_approval_min": _avg_minutes(r.get("approval_minutes") for r in occ),
        "avg_soc_to_occ_min": _avg_minutes(link_mins),
    }


@router.get("/bundle")
def requests_bundle(current_user: dict = Depends(get_current_user)):
    """SOC + OCC + KPIs en una sola lectura (menos idas a D1)."""
    with get_db() as conn:
        soc = rows_to_list(conn.execute(_soc_select(), (WAREHOUSE,)).fetchall())
        occ = rows_to_list(conn.execute(_occ_select(), (WAREHOUSE,)).fetchall())
    return {
        "summary": _summary_from_rows(soc, occ),
        "soc": soc,
        "occ": occ,
    }


@router.get("/summary")
def requests_summary(current_user: dict = Depends(get_current_user)):
    return requests_bundle(current_user)["summary"]
    minutes_soc = _minutes_sql("created_at", "approved_at")
    minutes_occ = _minutes_sql("created_at", "approved_at")
    minutes_link = (
        "CAST((julianday(o.created_at) - julianday(s.approved_at)) * 1440 AS INTEGER)"
    )

    with get_db() as conn:
        row = conn.execute(
            f"""SELECT
                  (SELECT COUNT(*) FROM purchase_request_lines WHERE warehouse = ?) AS soc_lines,
                  (SELECT COUNT(*) FROM purchase_order_lines WHERE warehouse = ?) AS occ_lines,
                  (SELECT COUNT(DISTINCT soc_number) FROM purchase_request_lines WHERE warehouse = ?) AS soc_documents,
                  (SELECT COUNT(DISTINCT occ_number) FROM purchase_order_lines WHERE warehouse = ?) AS occ_documents,
                  (SELECT AVG({minutes_soc})
                     FROM purchase_request_lines
                    WHERE warehouse = ? AND created_at IS NOT NULL AND approved_at IS NOT NULL
                      AND {minutes_soc} >= 0) AS avg_soc,
                  (SELECT AVG({minutes_occ})
                     FROM purchase_order_lines
                    WHERE warehouse = ? AND created_at IS NOT NULL AND approved_at IS NOT NULL
                      AND {minutes_occ} >= 0) AS avg_occ,
                  (SELECT AVG({minutes_link})
                     FROM purchase_request_lines s
                     JOIN purchase_order_lines o
                       ON o.warehouse = s.warehouse
                      AND o.soc_number = s.soc_number
                      AND o.item_code = s.item_code
                    WHERE s.warehouse = ?
                      AND s.approved_at IS NOT NULL
                      AND o.created_at IS NOT NULL
                      AND {minutes_link} >= 0) AS avg_link""",
            (WAREHOUSE, WAREHOUSE, WAREHOUSE, WAREHOUSE, WAREHOUSE, WAREHOUSE, WAREHOUSE),
        ).fetchone()

    return {
        "warehouse": WAREHOUSE,
        "soc_lines": row["soc_lines"] or 0,
        "occ_lines": row["occ_lines"] or 0,
        "soc_documents": row["soc_documents"] or 0,
        "occ_documents": row["occ_documents"] or 0,
        "avg_soc_approval_min": _round_avg(row["avg_soc"]),
        "avg_occ_approval_min": _round_avg(row["avg_occ"]),
        "avg_soc_to_occ_min": _round_avg(row["avg_link"]),
    }


@router.get("/soc")
def list_soc(current_user: dict = Depends(get_current_user)):
    return requests_bundle(current_user)["soc"]


@router.get("/occ")
def list_occ(current_user: dict = Depends(get_current_user)):
    return requests_bundle(current_user)["occ"]


@router.post("/sync-catalog")
def sync_catalog(current_user: dict = Depends(get_current_user)):
    with get_db() as conn:
        catalog = backfill_catalog(conn, current_user.get("id"))
    return {"ok": True, "catalog": catalog}


@router.post("/import/soc")
async def import_soc(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    payload = parse_soc_file(await _read_csv(file))
    saved = _upsert_soc(payload["rows"], current_user.get("id"))
    return {
        "kind": "soc",
        "imported": saved["lines"],
        "catalog": saved["catalog"],
        "skipped": payload["skipped"],
        "other_warehouse": payload["other_warehouse"],
        "errors": payload["errors"],
        "warehouse": WAREHOUSE,
    }


@router.post("/import/occ")
async def import_occ(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    payload = parse_occ_file(await _read_csv(file))
    saved = _upsert_occ(payload["rows"], current_user.get("id"))
    return {
        "kind": "occ",
        "imported": saved["lines"],
        "catalog": saved["catalog"],
        "skipped": payload["skipped"],
        "other_warehouse": payload["other_warehouse"],
        "errors": payload["errors"],
        "warehouse": WAREHOUSE,
    }


async def _read_csv(file: UploadFile) -> bytes:
    name = (file.filename or "").lower()
    if name and not name.endswith(".csv"):
        raise HTTPException(status_code=400, detail="El archivo debe ser .csv")
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="El archivo esta vacio")
    return raw


def _upsert_soc(rows: list[dict], user_id: int | None = None) -> dict:
    sql = """
        INSERT INTO purchase_request_lines (
            warehouse, soc_number, reference_doc, item_code, item_name,
            detail_ext_1, detail_ext_2, unit, qty_requested, qty_ordered, qty_pending,
            status, created_at, approved_at, requester, imported_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
        ON CONFLICT(warehouse, soc_number, item_code, detail_ext_1) DO UPDATE SET
            reference_doc = excluded.reference_doc,
            item_name     = excluded.item_name,
            detail_ext_2  = excluded.detail_ext_2,
            unit          = excluded.unit,
            qty_requested = excluded.qty_requested,
            qty_ordered   = excluded.qty_ordered,
            qty_pending   = excluded.qty_pending,
            status        = excluded.status,
            created_at    = excluded.created_at,
            approved_at   = excluded.approved_at,
            requester     = excluded.requester,
            imported_at   = datetime('now')
    """
    catalog = {"created": 0, "updated": 0, "received": 0}
    with get_db() as conn:
        for row in rows:
            conn.execute(sql, (
                row["warehouse"], row["soc_number"], row["reference_doc"], row["item_code"],
                row["item_name"], row["detail_ext_1"], row["detail_ext_2"], row["unit"],
                row["qty_requested"], row["qty_ordered"], row["qty_pending"],
                row["status"], row["created_at"], row["approved_at"], row["requester"],
            ))
            action = sync_from_soc(conn, row, user_id)
            catalog[action] += 1
    return {"lines": len(rows), "catalog": catalog}


def _upsert_occ(rows: list[dict], user_id: int | None = None) -> dict:
    sql = """
        INSERT INTO purchase_order_lines (
            warehouse, occ_number, soc_number, soc_raw, reference_doc,
            item_code, item_name, detail_ext_1, detail_ext_2, unit,
            qty_ordered, qty_entered, qty_pending, currency,
            unit_price, gross_value, discount_value, tax_value, net_value,
            status, created_at, approved_at, updated_at, due_days, buyer, supplier,
            imported_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
        ON CONFLICT(warehouse, occ_number, item_code, soc_number, detail_ext_1) DO UPDATE SET
            soc_raw        = excluded.soc_raw,
            reference_doc  = excluded.reference_doc,
            item_name      = excluded.item_name,
            detail_ext_2   = excluded.detail_ext_2,
            unit           = excluded.unit,
            qty_ordered    = excluded.qty_ordered,
            qty_entered    = excluded.qty_entered,
            qty_pending    = excluded.qty_pending,
            currency       = excluded.currency,
            unit_price     = excluded.unit_price,
            gross_value    = excluded.gross_value,
            discount_value = excluded.discount_value,
            tax_value      = excluded.tax_value,
            net_value      = excluded.net_value,
            status         = excluded.status,
            created_at     = excluded.created_at,
            approved_at    = excluded.approved_at,
            updated_at     = excluded.updated_at,
            due_days       = excluded.due_days,
            buyer          = excluded.buyer,
            supplier       = excluded.supplier,
            imported_at    = datetime('now')
    """
    catalog = {"created": 0, "updated": 0, "received": 0}
    with get_db() as conn:
        for row in rows:
            conn.execute(sql, (
                row["warehouse"], row["occ_number"], row["soc_number"], row["soc_raw"],
                row["reference_doc"], row["item_code"], row["item_name"],
                row["detail_ext_1"], row["detail_ext_2"], row["unit"],
                row["qty_ordered"], row["qty_entered"], row["qty_pending"], row["currency"],
                row["unit_price"], row["gross_value"], row["discount_value"],
                row["tax_value"], row["net_value"], row["status"],
                row["created_at"], row["approved_at"], row.get("updated_at"),
                row["due_days"], row["buyer"], row["supplier"],
            ))
            action, received = sync_from_occ(conn, row, user_id)
            catalog[action] += 1
            if received:
                catalog["received"] += 1
    return {"lines": len(rows), "catalog": catalog}


def _round_avg(value) -> float | None:
    if value is None:
        return None
    return round(float(value), 1)
