-- Identidad de hoja de laboratorio y base de dosis (% o g/L).

ALTER TABLE recipes ADD COLUMN yarn_title TEXT;
ALTER TABLE recipes ADD COLUMN commercial_ref TEXT;
ALTER TABLE recipe_ingredients ADD COLUMN dose_basis TEXT DEFAULT 'per_kg';
