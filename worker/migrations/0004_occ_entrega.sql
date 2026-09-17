-- Fecha de actualizacion SIESA en la OCC.
-- Solo cuenta como fecha de entrega a inventario cuando
-- qty_entered >= qty_ordered (entrega completa del pedido).
-- En ese momento qty_entered entra a stock y el item pasa a disponible.
-- inventory_applied evita duplicar la entrada al reimportar el mismo OCC.

ALTER TABLE purchase_order_lines ADD COLUMN updated_at TEXT;
ALTER TABLE purchase_order_lines ADD COLUMN inventory_applied INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_pol_applied ON purchase_order_lines(inventory_applied);
