-- Datos de ejemplo SOLO para la base local (npm run db:migrate:local + este archivo).
-- Uso: npx wrangler d1 execute tintoreria --local --file scripts/seed-local-inventory.sql
-- Deja el inventario de ejemplo en un estado conocido para la prueba de conteo.

INSERT OR IGNORE INTO roles (id, name, display_name, description, permissions)
VALUES (1, 'admin', 'Administrador', 'Acceso completo', '["*"]');
INSERT OR IGNORE INTO users (id, username, email, password_hash, full_name, role_id)
VALUES (1, 'admin', 'admin@tintoreria.local', 'no-usar', 'Administrador app', 1);

DELETE FROM stock_movements WHERE chemical_id IN (SELECT id FROM chemicals WHERE code LIKE 'PRB-%');
DELETE FROM inventory_count_line_history;
DELETE FROM inventory_count_lines WHERE count_id IN (SELECT id FROM inventory_counts);
DELETE FROM inventory_count_lots;
DELETE FROM inventory_count_items;
DELETE FROM inventory_counts;
DELETE FROM chemical_lots WHERE chemical_id IN (SELECT id FROM chemicals WHERE code LIKE 'PRB-%');
DELETE FROM chemicals WHERE code LIKE 'PRB-%';

INSERT INTO chemicals (id, name, code, chemical_type, unit, stock_quantity, lab_quantity, last_unit_price, density_g_ml, created_by) VALUES
  (9001, 'ACIDO ACETICO PRUEBA', 'PRB-001', 'acido', 'kg', 12, 1, 5000, 1.05, 1),
  (9002, 'SAL INDUSTRIAL PRUEBA', 'PRB-002', 'auxiliar', 'kg', 5, 0, 800, NULL, 1),
  (9003, 'COLORANTE ROJO PRUEBA', 'PRB-003', 'reactivo', 'kg', 3, 0, 90000, NULL, 1),
  (9004, 'SUAVIZANTE PRUEBA', 'PRB-004', 'auxiliar', 'kg', 0, 0, 7000, NULL, 1);

INSERT INTO chemical_lots (id, chemical_id, lot_number, quantity_received, quantity_remaining, lab_quantity, unit) VALUES
  (9101, 9001, '2609C1001', 8, 8, 1, 'kg'),
  (9102, 9001, '2609C1002', 4, 4, 0, 'kg'),
  (9103, 9002, 'S/N', 5, 5, 0, 'kg'),
  (9104, 9003, '2610C2001', 3, 3, 0, 'kg');
