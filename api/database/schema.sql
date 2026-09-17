-- =============================================================================
-- Tintoreria de Hilos - Esquema SQLite local
-- Capa local: Electron + Python FastAPI + SQLite
-- Compatible con Cloudflare D1 (mismo dialecto SQL)
-- =============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- -----------------------------------------------------------------------------
-- Roles y usuarios
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT,
    permissions TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name     TEXT NOT NULL,
    role_id       INTEGER NOT NULL DEFAULT 1,
    phone         TEXT,
    position      TEXT,
    is_active     INTEGER NOT NULL DEFAULT 1,
    last_login    TEXT,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (role_id) REFERENCES roles(id)
);

-- -----------------------------------------------------------------------------
-- Inventario de quimicos
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chemicals (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL,
    code             TEXT NOT NULL UNIQUE,
    chemical_type    TEXT NOT NULL CHECK(chemical_type IN (
                         'acido','reactivo','directo','auxiliar',
                         'mordiente','disperso','vat','blanqueador','otros')),
    unit             TEXT NOT NULL DEFAULT 'kg' CHECK(unit IN ('kg','g','L','mL')),
    density_g_ml     REAL,
    stock_quantity   REAL NOT NULL DEFAULT 0,
    min_stock_alert  REAL NOT NULL DEFAULT 0,
    max_stock        REAL,
    location         TEXT,
    supplier         TEXT,
    cas_number       TEXT,
    is_hazardous     INTEGER NOT NULL DEFAULT 0,
    safety_notes     TEXT,
    notes            TEXT,
    is_active        INTEGER NOT NULL DEFAULT 1,
    -- espera = SOC sin OCC; pedido = OCC sin ninguna entrada;
    -- disponible = hay stock en bodega (entrega total o parcial)
    procurement_status TEXT NOT NULL DEFAULT 'disponible',
    last_unit_price    REAL DEFAULT 0,
    last_unit_currency TEXT DEFAULT 'COP',
    pending_qty        REAL NOT NULL DEFAULT 0,
    created_by       INTEGER,
    created_at       TEXT DEFAULT (datetime('now')),
    updated_at       TEXT DEFAULT (datetime('now')),
    deleted_at       TEXT DEFAULT NULL,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Lotes de quimicos (trazabilidad por lote)
CREATE TABLE IF NOT EXISTS chemical_lots (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    chemical_id         INTEGER NOT NULL,
    lot_number          TEXT NOT NULL,
    quantity_received   REAL NOT NULL,
    quantity_remaining  REAL NOT NULL,
    unit                TEXT NOT NULL,
    purchase_date       TEXT,
    expiry_date         TEXT,
    unit_cost           REAL DEFAULT 0,
    supplier            TEXT,
    notes               TEXT,
    status              TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','depleted','expired')),
    created_at          TEXT DEFAULT (datetime('now')),
    updated_at          TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (chemical_id) REFERENCES chemicals(id)
);

-- Movimientos de inventario (auditoria completa)
CREATE TABLE IF NOT EXISTS stock_movements (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    chemical_id     INTEGER NOT NULL,
    lot_id          INTEGER,
    movement_type   TEXT NOT NULL CHECK(movement_type IN ('in','out','adjustment','waste','return')),
    quantity        REAL NOT NULL,
    unit            TEXT NOT NULL,
    reference_type  TEXT,
    reference_id    INTEGER,
    notes           TEXT,
    user_id         INTEGER NOT NULL,
    created_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (chemical_id) REFERENCES chemicals(id),
    FOREIGN KEY (lot_id)      REFERENCES chemical_lots(id),
    FOREIGN KEY (user_id)     REFERENCES users(id)
);

-- Solicitudes (SOC) y ordenes (OCC) importadas desde SIESA. Bodega 10502.
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
    updated_at     TEXT,
    due_days       INTEGER DEFAULT 0,
    buyer          TEXT,
    supplier       TEXT,
    inventory_applied INTEGER NOT NULL DEFAULT 0,
    qty_applied    REAL NOT NULL DEFAULT 0,
    imported_at    TEXT DEFAULT (datetime('now')),
    UNIQUE (warehouse, occ_number, item_code, soc_number, detail_ext_1)
);

-- -----------------------------------------------------------------------------
-- Maquinas
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS machines (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT NOT NULL,
    code                 TEXT NOT NULL UNIQUE,
    machine_type         TEXT NOT NULL CHECK(machine_type IN (
                             'tintura','lavado','secado','cardado','peinado','hilado','otros')),
    capacity_kg          REAL NOT NULL DEFAULT 0,
    water_capacity_liters REAL NOT NULL DEFAULT 0,
    status               TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','maintenance','inactive')),
    manufacturer         TEXT,
    model                TEXT,
    serial_number        TEXT,
    installation_date    TEXT,
    last_maintenance     TEXT,
    next_maintenance_due TEXT,
    description          TEXT,
    notes                TEXT,
    created_at           TEXT DEFAULT (datetime('now')),
    updated_at           TEXT DEFAULT (datetime('now'))
);

-- -----------------------------------------------------------------------------
-- Basculas (configuracion de conexion serial)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scales (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    name               TEXT NOT NULL,
    identifier         TEXT NOT NULL UNIQUE,
    port               TEXT,
    baud_rate          INTEGER DEFAULT 9600,
    data_bits          INTEGER DEFAULT 8,
    parity             TEXT DEFAULT 'N',
    stop_bits          INTEGER DEFAULT 1,
    protocol           TEXT DEFAULT 'generic',
    unit               TEXT DEFAULT 'g',
    precision_decimals INTEGER DEFAULT 2,
    max_weight         REAL,
    is_active          INTEGER DEFAULT 1,
    last_calibration   TEXT,
    notes              TEXT,
    created_at         TEXT DEFAULT (datetime('now')),
    updated_at         TEXT DEFAULT (datetime('now'))
);

-- -----------------------------------------------------------------------------
-- Recetas (formulas de tintura)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recipes (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    code              TEXT NOT NULL UNIQUE,
    name              TEXT NOT NULL,
    version           INTEGER NOT NULL DEFAULT 1,
    fiber_type        TEXT CHECK(fiber_type IN (
                          'lana','algodon','acrilico','poliester',
                          'nylon','seda','mezcla','otros')),
    color_reference   TEXT,
    color_name        TEXT,
    target_color_hex  TEXT,
    bath_ratio_l_per_kg REAL,
    temperature_c     REAL,
    process_time_min  INTEGER,
    yield_percentage  REAL DEFAULT 100,
    status            TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','draft','archived')),
    notes             TEXT,
    created_by        INTEGER NOT NULL,
    is_active         INTEGER NOT NULL DEFAULT 1,
    created_at        TEXT DEFAULT (datetime('now')),
    updated_at        TEXT DEFAULT (datetime('now')),
    deleted_at        TEXT DEFAULT NULL,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Pasos del proceso de la receta
CREATE TABLE IF NOT EXISTS recipe_steps (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id   INTEGER NOT NULL,
    step_order  INTEGER NOT NULL,
    step_name   TEXT NOT NULL,
    step_type   TEXT NOT NULL CHECK(step_type IN (
                    'pre_lavado','bano_tinte','fijacion',
                    'lavado','enjuague','secado','otros')),
    duration_min INTEGER,
    temperature_c REAL,
    ph_target    REAL,
    notes        TEXT,
    created_at   TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
);

-- Ingredientes de la receta (cantidad por kg de fibra)
CREATE TABLE IF NOT EXISTS recipe_ingredients (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id            INTEGER NOT NULL,
    step_id              INTEGER,
    chemical_id          INTEGER NOT NULL,
    quantity_per_kg      REAL NOT NULL,
    unit                 TEXT NOT NULL,
    tolerance_percentage REAL DEFAULT 5,
    is_critical          INTEGER DEFAULT 0,
    sort_order           INTEGER DEFAULT 0,
    notes                TEXT,
    created_at           TEXT DEFAULT (datetime('now')),
    updated_at           TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (recipe_id)   REFERENCES recipes(id) ON DELETE CASCADE,
    FOREIGN KEY (step_id)     REFERENCES recipe_steps(id) ON DELETE SET NULL,
    FOREIGN KEY (chemical_id) REFERENCES chemicals(id)
);

-- -----------------------------------------------------------------------------
-- Procesos de produccion (lotes)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS processes (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_number        TEXT NOT NULL UNIQUE,
    recipe_id           INTEGER NOT NULL,
    machine_id          INTEGER,
    fiber_type          TEXT,
    fiber_weight_kg     REAL NOT NULL,
    water_volume_liters REAL,
    color_reference     TEXT,
    operator_id         INTEGER NOT NULL,
    status              TEXT NOT NULL DEFAULT 'pending' CHECK(status IN (
                            'pending','in_progress','paused','completed','cancelled')),
    started_at          TEXT,
    completed_at        TEXT,
    total_time_min      INTEGER DEFAULT 0,
    quality_score       REAL,
    notes               TEXT,
    created_at          TEXT DEFAULT (datetime('now')),
    updated_at          TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (recipe_id)   REFERENCES recipes(id),
    FOREIGN KEY (machine_id)  REFERENCES machines(id),
    FOREIGN KEY (operator_id) REFERENCES users(id)
);

-- Pesajes por proceso (uno por ingrediente de la receta)
CREATE TABLE IF NOT EXISTS process_weighings (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    process_id            INTEGER NOT NULL,
    recipe_ingredient_id  INTEGER NOT NULL,
    chemical_id           INTEGER NOT NULL,
    lot_id                INTEGER,
    scale_id              INTEGER,
    expected_quantity     REAL NOT NULL,
    actual_quantity       REAL DEFAULT 0,
    unit                  TEXT NOT NULL,
    variance_percentage   REAL DEFAULT 0,
    is_within_tolerance   INTEGER DEFAULT 1,
    status                TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','weighed','validated','skipped')),
    weighed_at            TEXT,
    validated_by          INTEGER,
    notes                 TEXT,
    created_at            TEXT DEFAULT (datetime('now')),
    updated_at            TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (process_id)           REFERENCES processes(id) ON DELETE CASCADE,
    FOREIGN KEY (recipe_ingredient_id) REFERENCES recipe_ingredients(id),
    FOREIGN KEY (chemical_id)          REFERENCES chemicals(id),
    FOREIGN KEY (lot_id)               REFERENCES chemical_lots(id),
    FOREIGN KEY (scale_id)             REFERENCES scales(id),
    FOREIGN KEY (validated_by)         REFERENCES users(id)
);

-- Log de eventos del proceso
CREATE TABLE IF NOT EXISTS process_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    process_id  INTEGER NOT NULL,
    event_type  TEXT NOT NULL CHECK(event_type IN (
                    'create','start','pause','resume','weigh',
                    'validate','quality_check','complete','cancel','error')),
    description TEXT NOT NULL,
    data        TEXT,
    user_id     INTEGER,
    timestamp   TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (process_id) REFERENCES processes(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id)    REFERENCES users(id)
);

-- -----------------------------------------------------------------------------
-- Cola de sincronizacion con la capa web (Cloudflare Workers)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type     TEXT NOT NULL,
    entity_id       INTEGER NOT NULL,
    operation       TEXT NOT NULL CHECK(operation IN ('create','update','delete')),
    payload         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','error')),
    attempts        INTEGER DEFAULT 0,
    last_attempt_at TEXT,
    error_message   TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- Secuencias de codigos automaticos
CREATE TABLE IF NOT EXISTS code_sequences (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    sequence_type  TEXT NOT NULL UNIQUE,
    current_value  INTEGER NOT NULL DEFAULT 1,
    prefix         TEXT NOT NULL DEFAULT '',
    digits         INTEGER NOT NULL DEFAULT 6,
    created_at     TEXT DEFAULT (datetime('now')),
    updated_at     TEXT DEFAULT (datetime('now'))
);

-- -----------------------------------------------------------------------------
-- Indices
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_chemicals_code    ON chemicals(code);
CREATE INDEX IF NOT EXISTS idx_chemicals_type    ON chemicals(chemical_type);
CREATE INDEX IF NOT EXISTS idx_chemicals_active  ON chemicals(is_active, deleted_at);
CREATE INDEX IF NOT EXISTS idx_lots_chemical     ON chemical_lots(chemical_id);
CREATE INDEX IF NOT EXISTS idx_lots_status       ON chemical_lots(status);
CREATE INDEX IF NOT EXISTS idx_movements_chem    ON stock_movements(chemical_id);
CREATE INDEX IF NOT EXISTS idx_movements_date    ON stock_movements(created_at);
CREATE INDEX IF NOT EXISTS idx_recipes_code      ON recipes(code);
CREATE INDEX IF NOT EXISTS idx_recipes_active    ON recipes(is_active, deleted_at);
CREATE INDEX IF NOT EXISTS idx_ri_recipe         ON recipe_ingredients(recipe_id);
CREATE INDEX IF NOT EXISTS idx_processes_batch   ON processes(batch_number);
CREATE INDEX IF NOT EXISTS idx_processes_status  ON processes(status);
CREATE INDEX IF NOT EXISTS idx_processes_date    ON processes(created_at);
CREATE INDEX IF NOT EXISTS idx_weighings_process ON process_weighings(process_id);
CREATE INDEX IF NOT EXISTS idx_sync_status       ON sync_queue(status);
CREATE INDEX IF NOT EXISTS idx_sync_created      ON sync_queue(created_at);
CREATE INDEX IF NOT EXISTS idx_prl_warehouse ON purchase_request_lines(warehouse);
CREATE INDEX IF NOT EXISTS idx_prl_soc       ON purchase_request_lines(soc_number);
CREATE INDEX IF NOT EXISTS idx_prl_item      ON purchase_request_lines(item_code);
CREATE INDEX IF NOT EXISTS idx_pol_warehouse ON purchase_order_lines(warehouse);
CREATE INDEX IF NOT EXISTS idx_pol_occ       ON purchase_order_lines(occ_number);
CREATE INDEX IF NOT EXISTS idx_pol_item      ON purchase_order_lines(item_code);
CREATE INDEX IF NOT EXISTS idx_pol_applied   ON purchase_order_lines(inventory_applied);
