-- Tiempo de cierre de sesión por usuario. 0 = no cerrar por inactividad.
ALTER TABLE users ADD COLUMN idle_minutes INTEGER NOT NULL DEFAULT 30;
