-- Conteo por envases: "3 bultos de 25 kg + 12,5 kg sueltos".
-- Columnas opcionales: los registros por peso siguen igual (qty_entered + unit_entered).
-- qty sigue siendo el total en la unidad del producto, que es lo que se aplica.

ALTER TABLE inventory_count_lines ADD COLUMN package_type TEXT;
ALTER TABLE inventory_count_lines ADD COLUMN package_count REAL;
ALTER TABLE inventory_count_lines ADD COLUMN package_content REAL;
ALTER TABLE inventory_count_lines ADD COLUMN package_unit TEXT;
ALTER TABLE inventory_count_lines ADD COLUMN loose_qty REAL;
ALTER TABLE inventory_count_lines ADD COLUMN loose_unit TEXT;
