-- Saldo de laboratorio, separado de la bodega.
ALTER TABLE chemicals ADD COLUMN lab_quantity REAL NOT NULL DEFAULT 0;
ALTER TABLE chemical_lots ADD COLUMN lab_quantity REAL NOT NULL DEFAULT 0;
