-- Estado de compra en el catalogo de inventario.
-- espera  = llego por SOC, aun no hay OC
-- pedido  = ya hay OCC (proveedor + precio unitario)
-- disponible = stock listo para consumir (entrada, mas adelante)

ALTER TABLE chemicals ADD COLUMN procurement_status TEXT NOT NULL DEFAULT 'disponible';
ALTER TABLE chemicals ADD COLUMN last_unit_price REAL DEFAULT 0;
ALTER TABLE chemicals ADD COLUMN last_unit_currency TEXT DEFAULT 'COP';
ALTER TABLE chemicals ADD COLUMN pending_qty REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_chemicals_procurement ON chemicals(procurement_status);
