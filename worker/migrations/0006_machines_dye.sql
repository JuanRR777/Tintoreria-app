-- Formato de teñido, año y tipo industrial (Jet, Overflow, …).
-- machine_type CHECK original se mantiene; el tipo visible va en equipment_type.

ALTER TABLE machines ADD COLUMN dye_format TEXT NOT NULL DEFAULT 'ambos';
ALTER TABLE machines ADD COLUMN manufacture_year INTEGER;
ALTER TABLE machines ADD COLUMN equipment_type TEXT;
