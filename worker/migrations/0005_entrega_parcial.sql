-- Entrega parcial: qty_entered entra a stock aunque no cubra todo lo pedido.
-- qty_applied guarda cuánto ya se sumó al inventario para no duplicar
-- al reimportar. Cada incremento de Cant. entrada suma solo el delta.

ALTER TABLE purchase_order_lines ADD COLUMN qty_applied REAL NOT NULL DEFAULT 0;

UPDATE purchase_order_lines
   SET qty_applied = qty_entered
 WHERE COALESCE(inventory_applied, 0) = 1;
