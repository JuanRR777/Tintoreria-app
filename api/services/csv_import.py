"""Parser e importacion de CSV SOC/OCC (exportes SIESA / formato colombiano)."""

from __future__ import annotations

import csv
import io
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

WAREHOUSE = "10502"
BOGOTA = timezone(timedelta(hours=-5))

_SOC_RE = re.compile(r"(SOC-\d+)", re.I)
_DECIMAL_PART = re.compile(r"^\d{2,4}$")
_STATUS_CLEAN = re.compile(r"\s+")


def decode_csv_bytes(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def parse_rows(raw: bytes) -> list[list[str]]:
    text = decode_csv_bytes(raw).replace("\r\n", "\n").replace("\r", "\n")
    reader = csv.reader(io.StringIO(text))
    rows = []
    for row in reader:
        if not row or all(not str(cell).strip() for cell in row):
            continue
        rows.append([str(cell).strip() for cell in row])
    return rows


def normalize_soc(value: str) -> str:
    if not value:
        return ""
    match = _SOC_RE.search(value)
    return match.group(1).upper() if match else value.strip().upper()


def parse_es_datetime(value: str) -> Optional[str]:
    """Interpreta la hora del CSV como America/Bogota (UTC-5, sin DST)."""
    if not value:
        return None
    text = value.strip()
    text = (
        text.replace("a. m.", "AM")
        .replace("p. m.", "PM")
        .replace("a.m.", "AM")
        .replace("p.m.", "PM")
        .replace("a. m", "AM")
        .replace("p. m", "PM")
    )
    text = re.sub(r"\s+", " ", text)
    for fmt in ("%d/%m/%Y %I:%M %p", "%d/%m/%Y %H:%M", "%d/%m/%Y"):
        try:
            local = datetime.strptime(text, fmt).replace(tzinfo=BOGOTA)
            return local.isoformat(timespec="seconds")
        except ValueError:
            continue
    return None


def _parse_due_days(value: str) -> int:
    text = (value or "").strip().replace(" ", "").replace(",", ".")
    if not text:
        return 0
    try:
        return int(float(text))
    except ValueError:
        return 0


def parse_co_number(value: str) -> float:
    text = (value or "").strip()
    if not text:
        return 0.0
    text = text.replace(" ", "")
    if "," in text:
        left, right = text.rsplit(",", 1)
        left = left.replace(".", "")
        return float(f"{left}.{right}")
    if text.count(".") > 1:
        return float(text.replace(".", ""))
    return float(text)


def consume_co_number(fields: list[str], index: int) -> tuple[float, int]:
    if index >= len(fields):
        return 0.0, index
    left = fields[index]
    if index + 1 < len(fields) and _DECIMAL_PART.fullmatch(fields[index + 1]):
        integer = left.replace(".", "").replace(" ", "") or "0"
        if not re.fullmatch(r"-?\d+", integer):
            return parse_co_number(left), index + 1
        return float(f"{integer}.{fields[index + 1]}"), index + 2
    return parse_co_number(left), index + 1


def normalize_status(value: str) -> str:
    text = _STATUS_CLEAN.sub(" ", (value or "").strip()).lower()
    aliases = {
        "cumplido": "cumplido",
        "aprobado": "aprobado",
        "parcial": "parcial",
        "pendiente": "pendiente",
        "cerrado": "cerrado",
        "anulado": "anulado",
    }
    return aliases.get(text, text or "pendiente")


def _looks_header(row: list[str]) -> bool:
    joined = " ".join(row).lower()
    return "bodega" in joined or "nro solic" in joined or "nro orden" in joined


def parse_soc_file(raw: bytes) -> dict:
    rows = parse_rows(raw)
    imported: list[dict] = []
    skipped = 0
    other_warehouse = 0
    errors: list[str] = []

    for i, row in enumerate(rows, start=1):
        if i == 1 and _looks_header(row):
            continue
        try:
            record = _parse_soc_row(row)
        except Exception as exc:
            errors.append(f"Fila {i}: {exc}")
            continue
        if record["warehouse"] != WAREHOUSE:
            other_warehouse += 1
            continue
        if not record["soc_number"] or not record["item_code"]:
            skipped += 1
            continue
        imported.append(record)

    return {
        "kind": "soc",
        "rows": imported,
        "skipped": skipped,
        "other_warehouse": other_warehouse,
        "errors": errors,
    }


def parse_occ_file(raw: bytes) -> dict:
    rows = parse_rows(raw)
    imported: list[dict] = []
    skipped = 0
    other_warehouse = 0
    errors: list[str] = []

    for i, row in enumerate(rows, start=1):
        if i == 1 and _looks_header(row):
            continue
        try:
            record = _parse_occ_row(row)
        except Exception as exc:
            errors.append(f"Fila {i}: {exc}")
            continue
        if record["warehouse"] != WAREHOUSE:
            other_warehouse += 1
            continue
        if not record["occ_number"] or not record["item_code"]:
            skipped += 1
            continue
        imported.append(record)

    return {
        "kind": "occ",
        "rows": imported,
        "skipped": skipped,
        "other_warehouse": other_warehouse,
        "errors": errors,
    }


def _parse_soc_row(row: list[str]) -> dict:
    if len(row) < 9:
        raise ValueError("faltan columnas")
    index = 8
    qty_requested, index = consume_co_number(row, index)
    qty_ordered, index = consume_co_number(row, index)
    qty_pending, index = consume_co_number(row, index)
    status = normalize_status(_get(row, index))
    created_at = parse_es_datetime(_get(row, index + 1))
    approved_at = parse_es_datetime(_get(row, index + 2))
    requester = _get(row, index + 3)

    return {
        "warehouse": _get(row, 2),
        "soc_number": normalize_soc(_get(row, 0)),
        "reference_doc": _get(row, 1),
        "item_code": _pad_item(_get(row, 3)),
        "item_name": _get(row, 4),
        "detail_ext_1": _get(row, 5),
        "detail_ext_2": _get(row, 6),
        "unit": _get(row, 7).replace(" ", "") or "KG",
        "qty_requested": qty_requested,
        "qty_ordered": qty_ordered,
        "qty_pending": qty_pending,
        "status": status,
        "created_at": created_at,
        "approved_at": approved_at,
        "requester": requester,
    }


def _parse_occ_row(row: list[str]) -> dict:
    if len(row) < 10:
        raise ValueError("faltan columnas")
    index = 9
    qty_ordered, index = consume_co_number(row, index)
    qty_entered, index = consume_co_number(row, index)
    qty_pending, index = consume_co_number(row, index)
    currency = _get(row, index) or "COP"
    index += 1
    unit_price, index = consume_co_number(row, index)
    gross_value, index = consume_co_number(row, index)
    discount_value, index = consume_co_number(row, index)
    tax_value, index = consume_co_number(row, index)
    net_value, index = consume_co_number(row, index)
    status = normalize_status(_get(row, index))
    tail = _parse_occ_tail(row, index + 1)

    soc_raw = _get(row, 2)
    return {
        "warehouse": _get(row, 0),
        "occ_number": _get(row, 1),
        "soc_number": normalize_soc(soc_raw),
        "soc_raw": soc_raw,
        "reference_doc": _get(row, 3),
        "item_code": _pad_item(_get(row, 4)),
        "item_name": _get(row, 5),
        "detail_ext_1": _get(row, 6),
        "detail_ext_2": _get(row, 7),
        "unit": _get(row, 8).replace(" ", "") or "KG",
        "qty_ordered": qty_ordered,
        "qty_entered": qty_entered,
        "qty_pending": qty_pending,
        "currency": currency,
        "unit_price": unit_price,
        "gross_value": gross_value,
        "discount_value": discount_value,
        "tax_value": tax_value,
        "net_value": net_value,
        "status": status,
        "created_at": tail["created_at"],
        "approved_at": tail["approved_at"],
        "updated_at": tail["updated_at"],
        "due_days": tail["due_days"],
        "buyer": tail["buyer"],
        "supplier": tail["supplier"],
    }


def _parse_occ_tail(row: list[str], index: int) -> dict:
    """SIESA: Dias vcto, comprador, proveedor, creacion, aprobacion, actualizacion.
    Si el primer campo es fecha, se acepta ese orden alterno."""
    first = _get(row, index)
    if parse_es_datetime(first):
        created_at = parse_es_datetime(first)
        approved_at = parse_es_datetime(_get(row, index + 1))
        third = _get(row, index + 2)
        updated_at = parse_es_datetime(third)
        if updated_at:
            return {
                "created_at": created_at,
                "approved_at": approved_at,
                "updated_at": updated_at,
                "due_days": _parse_due_days(_get(row, index + 3)),
                "buyer": _get(row, index + 4),
                "supplier": _get(row, index + 5),
            }
        return {
            "created_at": created_at,
            "approved_at": approved_at,
            "updated_at": None,
            "due_days": _parse_due_days(third),
            "buyer": _get(row, index + 3),
            "supplier": _get(row, index + 4),
        }

    return {
        "due_days": _parse_due_days(first),
        "buyer": _get(row, index + 1),
        "supplier": _get(row, index + 2),
        "created_at": parse_es_datetime(_get(row, index + 3)),
        "approved_at": parse_es_datetime(_get(row, index + 4)),
        "updated_at": parse_es_datetime(_get(row, index + 5)),
    }


def _get(row: list[str], index: int) -> str:
    if index < 0 or index >= len(row):
        return ""
    return (row[index] or "").strip()


def _pad_item(code: str) -> str:
    text = (code or "").strip()
    if text.isdigit() and len(text) < 7:
        return text.zfill(7)
    return text
