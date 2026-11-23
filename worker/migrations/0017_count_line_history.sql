-- Historial de cada registro del conteo físico: quién lo creó, editó o borró,
-- con el valor antes y después y el motivo. El portal solo agrega entradas;
-- no tiene ninguna ruta para cambiarlas ni borrarlas.

CREATE TABLE IF NOT EXISTS inventory_count_line_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    line_id     INTEGER NOT NULL,
    count_id    INTEGER NOT NULL,
    chemical_id INTEGER,
    action      TEXT NOT NULL
                CHECK(action IN ('creado','editado','borrado','reconteo','asignado','descartado')),
    reason      TEXT,
    before_json TEXT,
    after_json  TEXT,
    user_id     INTEGER,
    username    TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (line_id)  REFERENCES inventory_count_lines(id),
    FOREIGN KEY (count_id) REFERENCES inventory_counts(id)
);

CREATE INDEX IF NOT EXISTS idx_line_history_line  ON inventory_count_line_history(line_id, id);
CREATE INDEX IF NOT EXISTS idx_line_history_count ON inventory_count_line_history(count_id, chemical_id, id);

-- Quién borró el registro y por qué; cuántas veces se editó.
ALTER TABLE inventory_count_lines ADD COLUMN deleted_by INTEGER;
ALTER TABLE inventory_count_lines ADD COLUMN delete_reason TEXT;
ALTER TABLE inventory_count_lines ADD COLUMN edit_count INTEGER NOT NULL DEFAULT 0;
