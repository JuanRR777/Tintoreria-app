-- Fases °C/min y pH por etapa de la receta.

ALTER TABLE recipe_steps ADD COLUMN bath_stage TEXT;
