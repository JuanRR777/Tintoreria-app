-- Tintoreria de Hilos - esquema D1 (Cloudflare)
-- Fuente de verdad remota. Sin cola de sync: la app local consulta D1 directo.

CREATE TABLE IF NOT EXISTS roles (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description  TEXT,
    permissions  TEXT NOT NULL DEFAULT '[]',
    created_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now'))
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
    created_by       INTEGER,
    created_at       TEXT DEFAULT (datetime('now')),
    updated_at       TEXT DEFAULT (datetime('now')),
    deleted_at       TEXT DEFAULT NULL,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

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

CREATE TABLE IF NOT EXISTS machines (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    name                  TEXT NOT NULL,
    code                  TEXT NOT NULL UNIQUE,
    machine_type          TEXT NOT NULL CHECK(machine_type IN (
                              'tintura','lavado','secado','cardado','peinado','hilado','otros')),
    capacity_kg           REAL NOT NULL DEFAULT 0,
    water_capacity_liters REAL NOT NULL DEFAULT 0,
    status                TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','maintenance','inactive')),
    manufacturer          TEXT,
    model                 TEXT,
    serial_number         TEXT,
    installation_date     TEXT,
    last_maintenance      TEXT,
    next_maintenance_due  TEXT,
    description           TEXT,
    notes                 TEXT,
    created_at            TEXT DEFAULT (datetime('now')),
    updated_at            TEXT DEFAULT (datetime('now'))
);

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

CREATE TABLE IF NOT EXISTS recipes (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    code                TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    version             INTEGER NOT NULL DEFAULT 1,
    fiber_type          TEXT CHECK(fiber_type IN (
                            'lana','algodon','acrilico','poliester',
                            'nylon','seda','mezcla','otros')),
    color_reference     TEXT,
    color_name          TEXT,
    target_color_hex    TEXT,
    bath_ratio_l_per_kg REAL,
    temperature_c       REAL,
    process_time_min    INTEGER,
    yield_percentage    REAL DEFAULT 100,
    status              TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','draft','archived')),
    notes               TEXT,
    created_by          INTEGER NOT NULL,
    is_active           INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT DEFAULT (datetime('now')),
    updated_at          TEXT DEFAULT (datetime('now')),
    deleted_at          TEXT DEFAULT NULL,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS recipe_steps (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id     INTEGER NOT NULL,
    step_order    INTEGER NOT NULL,
    step_name     TEXT NOT NULL,
    step_type     TEXT NOT NULL CHECK(step_type IN (
                      'pre_lavado','bano_tinte','fijacion',
                      'lavado','enjuague','secado','otros')),
    duration_min  INTEGER,
    temperature_c REAL,
    ph_target     REAL,
    notes         TEXT,
    created_at    TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
);

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

CREATE TABLE IF NOT EXISTS code_sequences (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    sequence_type  TEXT NOT NULL UNIQUE,
    current_value  INTEGER NOT NULL DEFAULT 1,
    prefix         TEXT NOT NULL DEFAULT '',
    digits         INTEGER NOT NULL DEFAULT 6,
    created_at     TEXT DEFAULT (datetime('now')),
    updated_at     TEXT DEFAULT (datetime('now'))
);

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
