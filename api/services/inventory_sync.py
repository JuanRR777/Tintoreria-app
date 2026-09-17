"""Sincroniza el catalogo de inventario a partir de SOC/OCC."""

from __future__ import annotations

from services.chemical_type import reclassify_otros, resolved_type

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


def _lot_number(row: dict) -> str:
    occ = (row.get("occ_number") or "OCC").strip()
    code = (row.get("item_code") or "").strip()
    return f"{occ}-{code}" if code else occ


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
    occ = row.get("occ_number") or ""
    notes = f"Entrada {'completa' if complete else 'parcial'} OCC {occ}"
    actor = int(user_id or 1)
    lot_no = _lot_number(row)

    existing_lot = conn.execute(
        """SELECT id FROM chemical_lots
           WHERE chemical_id = ? AND lot_number = ?""",
        (chemical_id, lot_no),
    ).fetchone()

    if existing_lot:
        lot_id = int(_scalar(existing_lot, "id"))
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
