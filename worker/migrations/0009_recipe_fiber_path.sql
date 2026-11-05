-- Ruta de proceso según fibra: tono en acrílico, preblanqueo/descrude en algodón.

ALTER TABLE recipes ADD COLUMN color_depth TEXT;
ALTER TABLE recipes ADD COLUMN process_route TEXT;
