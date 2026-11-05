-- Vistas permitidas por usuario. NULL usa los permisos del rol.
ALTER TABLE users ADD COLUMN permissions TEXT;
