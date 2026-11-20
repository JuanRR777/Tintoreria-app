-- Portal web: usuarios propios, sesiones, auditoría y bodegas.
-- Solo agrega tablas nuevas; la app de escritorio no las usa todavía.

CREATE TABLE IF NOT EXISTS web_users (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
    full_name            TEXT NOT NULL,
    email                TEXT,
    role                 TEXT NOT NULL CHECK(role IN ('admin','gerencia','compras','almacen','consulta')),
    password_hash        TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    is_active            INTEGER NOT NULL DEFAULT 1,
    failed_attempts      INTEGER NOT NULL DEFAULT 0,
    locked_until         TEXT,
    last_login_at        TEXT,
    password_changed_at  TEXT,
    created_by           INTEGER,
    created_at           TEXT DEFAULT (datetime('now')),
    updated_at           TEXT DEFAULT (datetime('now'))
);

-- El token nunca se guarda: solo su SHA-256.
CREATE TABLE IF NOT EXISTS web_sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash   TEXT NOT NULL UNIQUE,
    user_id      INTEGER NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at   TEXT NOT NULL,
    revoked_at   TEXT,
    ip           TEXT,
    user_agent   TEXT,
    FOREIGN KEY (user_id) REFERENCES web_users(id)
);

CREATE TABLE IF NOT EXISTS web_audit (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER,
    username   TEXT,
    event      TEXT NOT NULL,
    detail     TEXT,
    ip         TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS warehouses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    code       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'otra' CHECK(kind IN ('principal','laboratorio','otra')),
    is_active  INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO warehouses (code, name, kind, sort_order) VALUES
    ('10502', 'Principal', 'principal', 1),
    ('LAB', 'Laboratorio', 'laboratorio', 2);

CREATE INDEX IF NOT EXISTS idx_web_sessions_user  ON web_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_web_audit_created  ON web_audit(created_at);
CREATE INDEX IF NOT EXISTS idx_web_audit_ip_event ON web_audit(ip, event, created_at);
