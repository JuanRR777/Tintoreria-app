-- Solicitudes de compra (SOC) y ordenes de compra (OCC)
-- Solo se opera bodega 10502 a nivel de aplicacion.
-- approved_at en OCC = cuando se aprobo comprar, NO llegada a almacen.

CREATE TABLE IF NOT EXISTS purchase_request_lines (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    warehouse      TEXT NOT NULL DEFAULT '10502',
    soc_number     TEXT NOT NULL,
    reference_doc  TEXT,
    item_code      TEXT NOT NULL,
    item_name      TEXT NOT NULL,
    detail_ext_1   TEXT,
    detail_ext_2   TEXT,
    unit           TEXT NOT NULL DEFAULT 'KG',
    qty_requested  REAL NOT NULL DEFAULT 0,
    qty_ordered    REAL NOT NULL DEFAULT 0,
    qty_pending    REAL NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'pendiente',
    created_at     TEXT,
    approved_at    TEXT,
    requester      TEXT,
    imported_at    TEXT DEFAULT (datetime('now')),
    UNIQUE (warehouse, soc_number, item_code, detail_ext_1)
);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    warehouse      TEXT NOT NULL DEFAULT '10502',
    occ_number     TEXT NOT NULL,
    soc_number     TEXT,
    soc_raw        TEXT,
    reference_doc  TEXT,
    item_code      TEXT NOT NULL,
    item_name      TEXT NOT NULL,
    detail_ext_1   TEXT,
    detail_ext_2   TEXT,
    unit           TEXT NOT NULL DEFAULT 'KG',
    qty_ordered    REAL NOT NULL DEFAULT 0,
    qty_entered    REAL NOT NULL DEFAULT 0,
    qty_pending    REAL NOT NULL DEFAULT 0,
    currency       TEXT DEFAULT 'COP',
    unit_price     REAL DEFAULT 0,
    gross_value    REAL DEFAULT 0,
    discount_value REAL DEFAULT 0,
    tax_value      REAL DEFAULT 0,
    net_value      REAL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'aprobado',
    created_at     TEXT,
    approved_at    TEXT,
    due_days       INTEGER DEFAULT 0,
    buyer          TEXT,
    supplier       TEXT,
    imported_at    TEXT DEFAULT (datetime('now')),
    UNIQUE (warehouse, occ_number, item_code, soc_number, detail_ext_1)
);

CREATE INDEX IF NOT EXISTS idx_prl_warehouse ON purchase_request_lines(warehouse);
CREATE INDEX IF NOT EXISTS idx_prl_soc       ON purchase_request_lines(soc_number);
CREATE INDEX IF NOT EXISTS idx_prl_item      ON purchase_request_lines(item_code);
CREATE INDEX IF NOT EXISTS idx_prl_status    ON purchase_request_lines(status);

CREATE INDEX IF NOT EXISTS idx_pol_warehouse ON purchase_order_lines(warehouse);
CREATE INDEX IF NOT EXISTS idx_pol_occ       ON purchase_order_lines(occ_number);
CREATE INDEX IF NOT EXISTS idx_pol_soc       ON purchase_order_lines(soc_number);
CREATE INDEX IF NOT EXISTS idx_pol_item      ON purchase_order_lines(item_code);
CREATE INDEX IF NOT EXISTS idx_pol_status    ON purchase_order_lines(status);
