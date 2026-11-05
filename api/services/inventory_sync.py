"""Sincroniza el catalogo de inventario a partir de SOC/OCC."""

from __future__ import annotations

import re
from datetime import datetime

from services.chemical_type import reclassify_otros, resolved_type

_COMPACT_LOT_RE = re.compile(r"^\d{4}C\d+$")
_LEGACY_LOT_RE = re.compile(r"^(?:OCC-)?0*(\d+)-0*(\d+)$", re.IGNORECASE)

WAREHOUSE = "10502"


def map_unit(raw: str) -> str:
    unit = (raw or "KG").strip().upper()
    return {"KG": "kg", "G": "g", "L": "L", "ML": "mL"}.get(unit, "kg")


def item_display_name(row: dict) -> str:
    name = (row.get("item_name") or "").strip()
    detail = (row.get("detail_ext_1") or "").strip()
    if detail and detail.lower() not in name.lower():
        return f"{name} {detail}".strip()
    return name


def occ_fully_received(row: dict) -> bool:
    """Entrega completa: todo lo pedido ya consta como entrada."""
    ordered = float(row.get("qty_ordered") or 0)
    entered = float(row.get("qty_entered") or 0)
    return ordered > 0 and entered + 1e-6 >= ordered


def delivery_at(row: dict) -> str | None:
    """Fecha actualizacion SIESA solo si la OCC ya esta 100% entregada."""
    if not occ_fully_received(row):
        return None
    value = row.get("updated_at") or row.get("delivered_at")
    return value or None


def _scalar(row, key: str, index: int = 0):
    if row is None:
        return None
    if key in row:
        return row[key]
    return row[index]


def _last_id(conn) -> int:
    row = conn.execute("SELECT last_insert_rowid()").fetchone()
    return int(_scalar(row, "id") or _scalar(row, "last_insert_rowid()") or conn.lastrowid or 0)


def pending_for_item(conn, code: str) -> float:
    """Pendiente del item: OCC si ya hay orden; si no, SOC."""
    occ_n = _scalar(
        conn.execute(
            """SELECT COUNT(*) AS n FROM purchase_order_lines
               WHERE warehouse = ? AND item_code = ?""",
            (WAREHOUSE, code),
        ).fetchone(),
        "n",
    ) or 0
    table = "purchase_order_lines" if occ_n else "purchase_request_lines"
    qty = _scalar(
        conn.execute(
            f"""SELECT COALESCE(SUM(qty_pending), 0) AS qty
                FROM {table}
                WHERE warehouse = ? AND item_code = ?""",
            (WAREHOUSE, code),
        ).fetchone(),
        "qty",
    )
    return float(qty or 0)


def sync_from_soc(conn, row: dict, user_id: int | None = None) -> str:
    """Crea o marca el item como en espera. No toca stock."""
    code = row["item_code"]
    name = item_display_name(row)
    unit = map_unit(row.get("unit"))
    pending = pending_for_item(conn, code)
    existing = conn.execute(
        """SELECT id, name, procurement_status, stock_quantity, chemical_type
           FROM chemicals WHERE code = ? AND deleted_at IS NULL""",
        (code,),
    ).fetchone()

    chem_type = resolved_type(
        name,
        existing["chemical_type"] if existing else None,
        row.get("detail_ext_1") or "",
    )

    if not existing:
        conn.execute(
            """INSERT INTO chemicals
               (name, code, chemical_type, unit, stock_quantity, supplier,
                procurement_status, pending_qty, created_by, notes)
               VALUES (?, ?, ?, ?, 0, NULL, 'espera', ?, ?, ?)""",
            (name, code, chem_type, unit, pending, user_id, f"Alta por SOC {row.get('soc_number') or ''}"),
        )
        return "created"

    status = (existing["procurement_status"] or "disponible").lower()
    stock_qty = existing["stock_quantity"] or 0
    if status == "disponible" and stock_qty <= 0:
        status = "espera"
    elif status not in ("pedido", "disponible"):
        status = "espera"

    conn.execute(
        """UPDATE chemicals
           SET name = ?, unit = ?, pending_qty = ?,
               procurement_status = ?, chemical_type = ?, updated_at = datetime('now')
           WHERE id = ?""",
        (name or existing["name"] or code, unit, pending, status, chem_type, existing["id"]),
    )
    return "updated"


def sync_from_occ(conn, row: dict, user_id: int | None = None) -> tuple[str, bool]:
    """Clasifica el item. Toda cant. entrada (parcial o total) suma a inventario."""
    code = row["item_code"]
    name = item_display_name(row)
    unit = map_unit(row.get("unit"))
    supplier = (row.get("supplier") or "").strip() or None
    price = row.get("unit_price") or 0
    currency = row.get("currency") or "COP"

    existing = conn.execute(
        """SELECT id, procurement_status, stock_quantity, name, chemical_type
           FROM chemicals WHERE code = ? AND deleted_at IS NULL""",
        (code,),
    ).fetchone()

    chem_type = resolved_type(
        name,
        existing["chemical_type"] if existing else None,
        row.get("detail_ext_1") or "",
    )

    if not existing:
        conn.execute(
            """INSERT INTO chemicals
               (name, code, chemical_type, unit, stock_quantity, supplier,
                procurement_status, last_unit_price, last_unit_currency,
                pending_qty, created_by, notes)
               VALUES (?, ?, ?, ?, 0, ?, 'pedido', ?, ?, 0, ?, ?)""",
            (
                name, code, chem_type, unit, supplier, price, currency, user_id,
                f"Alta por OCC {row.get('occ_number') or ''}",
            ),
        )
        chemical_id = _last_id(conn)
        action = "created"
    else:
        chemical_id = existing["id"]
        action = "updated"

    received = _apply_occ_receipt(conn, chemical_id, row, user_id)
    pending = pending_for_item(conn, code)
    chem = conn.execute(
        "SELECT stock_quantity FROM chemicals WHERE id = ?",
        (chemical_id,),
    ).fetchone()
    stock_qty = float(_scalar(chem, "stock_quantity") or 0)
    status = "disponible" if received or stock_qty > 0 else "pedido"

    conn.execute(
        """UPDATE chemicals
           SET name = ?, unit = ?, supplier = ?,
               last_unit_price = ?, last_unit_currency = ?,
               pending_qty = ?, procurement_status = ?, chemical_type = ?,
               updated_at = datetime('now')
           WHERE id = ?""",
        (
            name or (existing["name"] if existing else code), unit, supplier,
            price, currency, pending, status, chem_type, chemical_id,
        ),
    )
    return action, received


def _occ_line(conn, row: dict):
    line_id = row.get("id")
    if line_id not in (None, ""):
        found = conn.execute(
            """SELECT id, inventory_applied, qty_applied
               FROM purchase_order_lines WHERE id = ?""",
            (line_id,),
        ).fetchone()
        if found:
            return found
    return conn.execute(
        """SELECT id, inventory_applied, qty_applied
           FROM purchase_order_lines
           WHERE warehouse = ? AND occ_number = ? AND item_code = ?
             AND COALESCE(soc_number, '') = ?
             AND COALESCE(detail_ext_1, '') = ?""",
        (
            row.get("warehouse") or WAREHOUSE,
            row["occ_number"],
            row["item_code"],
            row.get("soc_number") or "",
            row.get("detail_ext_1") or "",
        ),
    ).fetchone()


def _digits_no_zeros(value) -> str:
    digits = "".join(ch for ch in str(value or "") if ch.isdigit())
    return digits.lstrip("0") or "0"


def _parse_entry_date(when) -> datetime | None:
    if not when:
        return None
    text = str(when).strip().replace("Z", "").replace("T", " ")
    for fmt, size in (("%Y-%m-%d %H:%M:%S", 19), ("%Y-%m-%d", 10)):
        try:
            return datetime.strptime(text[:size], fmt)
        except ValueError:
            continue
    return None


def _entry_yymm(when) -> str:
    parsed = _parse_entry_date(when) or datetime.now()
    return parsed.strftime("%y%m")


def compact_purchase_lot(occ_number, item_code, when=None) -> str:
    """YYMM + C + OCC sin ceros + item sin ceros. Ej: 2609C3045427912."""
    return f"{_entry_yymm(when)}C{_digits_no_zeros(occ_number)}{_digits_no_zeros(item_code)}"


def _legacy_lot_number(row: dict) -> str:
    occ = (row.get("occ_number") or "OCC").strip()
    code = (row.get("item_code") or "").strip()
    return f"{occ}-{code}" if code else occ


def _lot_number(row: dict, when=None) -> str:
    return compact_purchase_lot(row.get("occ_number"), row.get("item_code"), when)


def _existing_occ_lot(conn, chemical_id: int, row: dict, lot_no: str):
    occ_d = _digits_no_zeros(row.get("occ_number"))
    item_d = _digits_no_zeros(row.get("item_code"))
    glob = f"????C{occ_d}{item_d}"
    return conn.execute(
        """SELECT id, lot_number, purchase_date, created_at FROM chemical_lots
           WHERE chemical_id = ?
             AND (lot_number = ? OR lot_number = ? OR lot_number GLOB ?)
           ORDER BY id ASC""",
        (chemical_id, lot_no, _legacy_lot_number(row), glob),
    ).fetchone()


def migrate_legacy_lot_numbers(conn, chemical_id: int | None = None) -> int:
    sql = "SELECT id, lot_number, purchase_date, created_at FROM chemical_lots"
    params: list = []
    if chemical_id is not None:
        sql += " WHERE chemical_id = ?"
        params.append(chemical_id)
    rows = conn.execute(sql, params).fetchall()
    changed = 0
    for row in rows:
        number = str(_scalar(row, "lot_number") or "")
        if _COMPACT_LOT_RE.match(number):
            continue
        match = _LEGACY_LOT_RE.match(number)
        if not match:
            continue
        when = _scalar(row, "purchase_date") or _scalar(row, "created_at")
        new = compact_purchase_lot(match.group(1), match.group(2), when)
        if new == number:
            continue
        conn.execute(
            "UPDATE chemical_lots SET lot_number = ?, updated_at = datetime('now') WHERE id = ?",
            (new, _scalar(row, "id")),
        )
        changed += 1
    return changed


def _moved_qty(conn, line_id: int) -> float:
    row = conn.execute(
        """SELECT COALESCE(SUM(quantity), 0) AS qty
           FROM stock_movements
           WHERE reference_type = 'occ_receipt' AND reference_id = ?""",
        (line_id,),
    ).fetchone()
    return float(_scalar(row, "qty") or 0)


def _qty_already_applied(conn, line, entered: float) -> float:
    moved = _moved_qty(conn, int(_scalar(line, "id")))
    if moved > 0:
        return moved
    applied = float(_scalar(line, "qty_applied") or 0) if "qty_applied" in line else 0.0
    if applied > 0:
        return applied
    if int(_scalar(line, "inventory_applied") or 0):
        return entered
    return 0.0


def _apply_occ_receipt(conn, chemical_id: int, row: dict, user_id: int | None) -> bool:
    """Suma a stock el incremento de qty_entered (parcial o total)."""
    entered = float(row.get("qty_entered") or 0)
    if entered <= 0:
        return False

    line = _occ_line(conn, row)
    if not line:
        return False

    already = _qty_already_applied(conn, line, entered)
    qty = round(entered - already, 6)
    if qty <= 1e-6:
        return False

    chem = conn.execute(
        "SELECT unit FROM chemicals WHERE id = ?",
        (chemical_id,),
    ).fetchone()
    unit = (chem["unit"] if chem else None) or map_unit(row.get("unit"))
    complete = occ_fully_received(row)
    delivered = delivery_at(row) or row.get("updated_at")
    purchase_date = str(delivered).replace("T", " ")[:10] if delivered else None
    occ = str(row.get("occ_number") or "").strip()
    occ_label = occ if occ.upper().startswith("OCC") else (f"OCC {occ}" if occ else "OCC")
    notes = f"Entrada {'completa' if complete else 'parcial'} {occ_label}"
    actor = int(user_id or 1)
    lot_no = _lot_number(row, purchase_date)

    existing_lot = _existing_occ_lot(conn, chemical_id, row, lot_no)

    if existing_lot:
        lot_id = int(_scalar(existing_lot, "id"))
        current_no = str(_scalar(existing_lot, "lot_number") or "")
        if not _COMPACT_LOT_RE.match(current_no):
            when = _scalar(existing_lot, "purchase_date") or _scalar(existing_lot, "created_at") or purchase_date
            compact = _lot_number(row, when)
            if compact != current_no:
                conn.execute(
                    "UPDATE chemical_lots SET lot_number = ?, updated_at = datetime('now') WHERE id = ?",
                    (compact, lot_id),
                )
        conn.execute(
            """UPDATE chemical_lots
               SET quantity_received = quantity_received + ?,
                   quantity_remaining = quantity_remaining + ?,
                   status = 'active',
                   updated_at = datetime('now')
               WHERE id = ?""",
            (qty, qty, lot_id),
        )
    else:
        conn.execute(
            """INSERT INTO chemical_lots
               (chemical_id, lot_number, quantity_received, quantity_remaining, unit,
                purchase_date, unit_cost, supplier, notes)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                chemical_id, lot_no, qty, qty, unit,
                purchase_date, row.get("unit_price") or 0,
                (row.get("supplier") or "").strip() or None, notes,
            ),
        )
        lot_id = _last_id(conn)

    conn.execute(
        """UPDATE chemicals
           SET stock_quantity = stock_quantity + ?, updated_at = datetime('now')
           WHERE id = ?""",
        (qty, chemical_id),
    )

    if delivered:
        conn.execute(
            """INSERT INTO stock_movements
               (chemical_id, lot_id, movement_type, quantity, unit,
                reference_type, reference_id, notes, user_id, created_at)
               VALUES (?,?,'in',?,?,'occ_receipt',?,?,?,?)""",
            (chemical_id, lot_id, qty, unit, line["id"], notes, actor, delivered),
        )
    else:
        conn.execute(
            """INSERT INTO stock_movements
               (chemical_id, lot_id, movement_type, quantity, unit,
                reference_type, reference_id, notes, user_id)
               VALUES (?,?,'in',?,?,'occ_receipt',?,?,?)""",
            (chemical_id, lot_id, qty, unit, line["id"], notes, actor),
        )

    conn.execute(
        """UPDATE purchase_order_lines
           SET inventory_applied = ?
           WHERE id = ?""",
        (1 if complete else 0, line["id"]),
    )
    try:
        conn.execute(
            "UPDATE purchase_order_lines SET qty_applied = ? WHERE id = ?",
            (entered, line["id"]),
        )
    except Exception:
        pass
    return True


def backfill_catalog(conn, user_id: int | None = None) -> dict:
    """Recorre SOC y OCC ya guardadas y deja el catalogo al dia."""
    catalog = {"created": 0, "updated": 0, "received": 0}
    soc_rows = conn.execute(
        "SELECT * FROM purchase_request_lines WHERE warehouse = ?",
        (WAREHOUSE,),
    ).fetchall()
    for row in soc_rows:
        action = sync_from_soc(conn, row, user_id)
        catalog[action] += 1

    occ_rows = conn.execute(
        "SELECT * FROM purchase_order_lines WHERE warehouse = ?",
        (WAREHOUSE,),
    ).fetchall()
    for row in occ_rows:
        action, received = sync_from_occ(conn, row, user_id)
        catalog[action] += 1
        if received:
            catalog["received"] += 1
    catalog["classified"] = reclassify_otros(conn)
    catalog["lots_renamed"] = migrate_legacy_lot_numbers(conn)
    return catalog


def apply_open_receipts(conn, user_id: int | None = None) -> int:
    """Aplica a stock las OCC con cant. entrada que aun no se ha sumado."""
    rows = conn.execute(
        """SELECT * FROM purchase_order_lines
           WHERE warehouse = ?
             AND qty_entered > 0.0001
             AND COALESCE(qty_applied, 0) + 0.0001 < qty_entered""",
        (WAREHOUSE,),
    ).fetchall()
    applied = 0
    for row in rows:
        _, received = sync_from_occ(conn, row, user_id)
        if received:
            applied += 1
    return applied


def _norm_lot(value: str) -> str:
    text = " ".join(str(value or "").split())
    if not text or text.upper() in ("S/N", "S.N", "S.N.", "SN", "SIN LOTE", "N/A"):
        return "S/N"
    return text


def apply_inventory_snapshot(conn, rows: list[dict], user_id: int | None = None) -> dict:
    """Deja el stock de bodega como el informe: item, nombre, kilos y lote. No toca precios."""
    grouped: dict[str, dict] = {}
    for row in rows:
        code = (row.get("item_code") or "").strip()
        if not code:
            continue
        bucket = grouped.setdefault(code, {
            "name": (row.get("item_name") or "").strip(),
            "unit": map_unit(row.get("unit")),
            "lots": {},
        })
        if not bucket["name"] and row.get("item_name"):
            bucket["name"] = str(row["item_name"]).strip()
        lot_no = _norm_lot(row.get("lot_number"))
        bucket["lots"][lot_no] = bucket["lots"].get(lot_no, 0.0) + float(row.get("qty") or 0)

    stats = {"created": 0, "updated": 0, "lots": 0, "kg": 0.0}
    actor = int(user_id or 1)

    for code, data in grouped.items():
        name = data["name"] or code
        unit = data["unit"] or "kg"
        total = round(sum(data["lots"].values()), 6)
        existing = conn.execute(
            """SELECT id, name, stock_quantity, chemical_type, last_unit_price
               FROM chemicals WHERE code = ? AND deleted_at IS NULL""",
            (code,),
        ).fetchone()
        chem_type = resolved_type(name, existing["chemical_type"] if existing else None)

        if not existing:
            conn.execute(
                """INSERT INTO chemicals
                   (name, code, chemical_type, unit, stock_quantity, location,
                    procurement_status, last_unit_price, last_unit_currency,
                    pending_qty, created_by, notes)
                   VALUES (?, ?, ?, ?, ?, ?, 'disponible', 0, 'COP', 0, ?, ?)""",
                (name, code, chem_type, unit, total, WAREHOUSE, actor, "Carga inventario bodega 10502"),
            )
            chemical_id = _last_id(conn)
            old_stock = 0.0
            stats["created"] += 1
        else:
            chemical_id = int(_scalar(existing, "id"))
            old_stock = float(_scalar(existing, "stock_quantity") or 0)
            conn.execute(
                """UPDATE chemicals
                   SET name = ?, unit = ?, stock_quantity = ?, location = ?,
                       procurement_status = ?, chemical_type = ?,
                       updated_at = datetime('now')
                   WHERE id = ?""",
                (name or existing["name"] or code, unit, total, WAREHOUSE, 'disponible', chem_type, chemical_id),
            )
            stats["updated"] += 1

        current_lots = conn.execute(
            "SELECT id, lot_number FROM chemical_lots WHERE chemical_id = ?",
            (chemical_id,),
        ).fetchall()
        by_lot = {_norm_lot(_scalar(lot, "lot_number")): lot for lot in current_lots}
        seen: set[str] = set()

        for lot_no, qty in data["lots"].items():
            qty = round(float(qty or 0), 6)
            if qty <= 0:
                continue
            seen.add(lot_no)
            prev = by_lot.get(lot_no)
            lot_status = "active"
            if prev:
                conn.execute(
                    """UPDATE chemical_lots
                       SET quantity_remaining = ?, quantity_received = ?,
                           status = ?, unit = ?, notes = ?, updated_at = datetime('now')
                       WHERE id = ?""",
                    (qty, qty, lot_status, unit, "Inventario bodega 10502", int(_scalar(prev, "id"))),
                )
            else:
                conn.execute(
                    """INSERT INTO chemical_lots
                       (chemical_id, lot_number, quantity_received, quantity_remaining, unit, notes)
                       VALUES (?,?,?,?,?,?)""",
                    (chemical_id, lot_no, qty, qty, unit, "Inventario bodega 10502"),
                )
            stats["lots"] += 1

        for lot_no, prev in by_lot.items():
            if lot_no in seen:
                continue
            conn.execute(
                """UPDATE chemical_lots
                   SET quantity_remaining = 0, status = 'depleted', updated_at = datetime('now')
                   WHERE id = ?""",
                (int(_scalar(prev, "id")),),
            )

        delta = round(total - old_stock, 6)
        if abs(delta) > 1e-6:
            conn.execute(
                """INSERT INTO stock_movements
                   (chemical_id, movement_type, quantity, unit,
                    reference_type, notes, user_id)
                   VALUES (?, 'adjustment', ?, ?, 'inv_snapshot', ?, ?)""",
                (chemical_id, delta, unit, f"Inventario bodega {WAREHOUSE}", actor),
            )
        stats["kg"] += total

    stats["kg"] = round(stats["kg"], 3)
    stats["classified"] = reclassify_otros(conn)
    return stats
