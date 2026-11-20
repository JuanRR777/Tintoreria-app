-- Conteo físico por bodega desde el portal web.
-- Flujo: abierto (se cuenta) → revision (se revisa) → aplicado (ajusta el inventario).
-- Solo agrega tablas; el inventario cambia únicamente al aplicar un conteo.

CREATE TABLE IF NOT EXISTS inventory_counts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    warehouse_id      INTEGER NOT NULL,
    status            TEXT NOT NULL DEFAULT 'abierto'
                      CHECK(status IN ('abierto','revision','aplicado','anulado')),
    notes             TEXT,
    opened_by         INTEGER NOT NULL,
    opened_at         TEXT NOT NULL DEFAULT (datetime('now')),
    closed_by         INTEGER,
    closed_at         TEXT,
    applied_by        INTEGER,
    applied_at        TEXT,
    siesa_adjusted_by INTEGER,
    siesa_adjusted_at TEXT,
    cancelled_by      INTEGER,
    cancelled_at      TEXT,
    updated_at        TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
    FOREIGN KEY (opened_by)    REFERENCES web_users(id)
);

-- Un solo conteo activo por bodega.
CREATE UNIQUE INDEX IF NOT EXISTS ux_inventory_counts_active
    ON inventory_counts(warehouse_id) WHERE status IN ('abierto','revision');

-- Foto del catálogo y del saldo de la bodega al abrir el conteo.
CREATE TABLE IF NOT EXISTS inventory_count_items (
    count_id             INTEGER NOT NULL,
    chemical_id          INTEGER NOT NULL,
    code                 TEXT NOT NULL,
    name                 TEXT NOT NULL,
    unit                 TEXT NOT NULL,
    system_qty           REAL NOT NULL DEFAULT 0,
    unit_price           REAL DEFAULT 0,
    currency             TEXT DEFAULT 'COP',
    confirmed_zero_at    TEXT,
    confirmed_zero_by    INTEGER,
    recount_requested_at TEXT,
    PRIMARY KEY (count_id, chemical_id),
    FOREIGN KEY (count_id)    REFERENCES inventory_counts(id),
    FOREIGN KEY (chemical_id) REFERENCES chemicals(id)
);

CREATE TABLE IF NOT EXISTS inventory_count_lots (
    count_id    INTEGER NOT NULL,
    chemical_id INTEGER NOT NULL,
    lot_id      INTEGER NOT NULL,
    lot_number  TEXT NOT NULL,
    system_qty  REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (count_id, lot_id),
    FOREIGN KEY (count_id) REFERENCES inventory_counts(id),
    FOREIGN KEY (lot_id)   REFERENCES chemical_lots(id)
);

-- Lo que registran las personas. chemical_id NULL = hallazgo (producto que no
-- está en el catálogo) hasta que el administrador lo asigne o lo descarte.
CREATE TABLE IF NOT EXISTS inventory_count_lines (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    count_id       INTEGER NOT NULL,
    chemical_id    INTEGER,
    finding_name   TEXT,
    finding_status TEXT CHECK(finding_status IN ('pendiente','asignado','descartado')),
    lot_id         INTEGER,
    lot_number     TEXT NOT NULL DEFAULT 'S/N',
    qty            REAL NOT NULL CHECK(qty >= 0),
    qty_entered    REAL NOT NULL CHECK(qty_entered >= 0),
    unit_entered   TEXT NOT NULL,
    location       TEXT,
    notes          TEXT,
    client_uuid    TEXT NOT NULL,
    counted_by     INTEGER NOT NULL,
    counted_at     TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at     TEXT,
    superseded_at  TEXT,
    deleted_at     TEXT,
    UNIQUE (count_id, client_uuid),
    FOREIGN KEY (count_id)    REFERENCES inventory_counts(id),
    FOREIGN KEY (chemical_id) REFERENCES chemicals(id),
    FOREIGN KEY (lot_id)      REFERENCES chemical_lots(id),
    FOREIGN KEY (counted_by)  REFERENCES web_users(id)
);

CREATE INDEX IF NOT EXISTS idx_count_lines_item ON inventory_count_lines(count_id, chemical_id);
CREATE INDEX IF NOT EXISTS idx_count_lots_item  ON inventory_count_lots(count_id, chemical_id);
CREATE INDEX IF NOT EXISTS idx_stock_mov_chem_date ON stock_movements(chemical_id, created_at);
