# Flujo: desarrollo local → deploy a planta

Guía práctica para no mezclar **probar en tu PC** con **publicar instalador**.

---

## Dos modos (no los confundas)

| Modo | Cuándo | Comando principal |
|------|--------|-------------------|
| **Local** | Cambios a medias, UI, API, pruebas | `npm run dev` en `ui/` |
| **Deploy** | Cambio listo; PCs en planta deben recibirlo | Subir `version` + `deploy-release.bat` |

En local **no** corre el updater ni el empaquetado Python embebido: usas tu `api/` y `api/.env` del repo.

---

## 1. Desarrollo local (día a día)

```powershell
# Terminal 1 — API (opcional; Electron también la levanta)
cd C:\Users\DESARROLLADOR\Documents\produccion2026\api
.\.venv\Scripts\activate
python -u main.py

# Terminal 2 — ventana Electron
cd C:\Users\DESARROLLADOR\Documents\produccion2026\ui
npm run dev
```

**Qué editas:**

- Pantallas / JS / CSS → `ui/src/`
- Backend → `api/`
- Variables locales → `api/.env` (no se sube a Git)

**Cómo validar:** usa la app en la ventana de Electron; si algo falla, mira consola (DevTools) o `api/startup.log`.

**Cuándo parar local y pensar en deploy:** la función se ve bien en dev, no rompe login/flujo principal, y (si tocaste API) probaste el endpoint que cambiaste.

---

## 2. Antes de deploy (checklist corta)

- [ ] Cambios guardados; si usas Git, commit (opcional pero recomendable).
- [ ] **`ui/package.json` → `version`** subida (p. ej. `1.0.2` → `1.0.3`). Sin esto, GitHub no publica una release “nueva” y el updater no avisa.
- [ ] `C:\KEY\release.env` existe con `GH_TOKEN` y `CSC_KEY_PASSWORD` (una sola vez).
- [ ] No subiste secretos (`.env`, `.pfx`, `release.env`).

---

## 3. Deploy (publicar a GitHub + instalador)

```powershell
# Opción A — doble clic
ui\deploy-release.bat

# Opción B — terminal
cd ui
npm run deploy
```

**Qué hace:** empaqueta Python + API, firma el `.exe`, sube a **GitHub Releases** (publicada, no draft) con `latest.yml`.

**Tiempo:** varios minutos; no hace falta repetirlo por cada cambio pequeño en local.

**Comprobar en GitHub:** repo → **Releases** → versión nueva **sin** badge Draft, assets con `.exe` y `latest.yml`.

---

## 4. Probar como planta (sin adivinar)

### A) En tu mismo PC (instalador real)

1. Instala (o actualiza) con el `.exe` de `ui/dist/` **o** desde la release en GitHub.
2. La app instalada usa `%LOCALAPPDATA%\Tintoreria\.env`, no `api/.env` del repo.
3. **Configuración → Aplicación → Buscar actualizaciones** solo funciona en la app **instalada**, no en `npm run dev`.

### B) En el otro PC (flujo habitual)

1. Ya tiene una versión anterior instalada.
2. Abre app → **Configuración → Aplicación** → buscar / descargar / reiniciar.
3. Desde **1.0.2+** la instalación al actualizar es silenciosa y reabre la app.

---

## 5. Ejercicio de práctica (simulación)

Hazlo una vez con un cambio mínimo para memorizar el flujo:

1. **Local:** en `ui/src/index.html` o un texto visible, cambia algo obvio → `npm run dev` → comprueba que se ve.
2. **Versión:** en `package.json` pasa a la siguiente patch (ej. `1.0.3`).
3. **Deploy:** `deploy-release.bat` → espera OK y release en GitHub.
4. **Planta simulada:** en un PC con la app instalada, buscar actualizaciones y aplicar.
5. **Local otra vez:** vuelve a `npm run dev` para el siguiente cambio; no dejes la app instalada abierta si quieres seguir editando en caliente en dev.

---

## Errores típicos

| Síntoma | Causa probable |
|---------|----------------|
| Updater no ve nada | Release en **Draft**, o `version` no subió |
| En dev no hay “Buscar actualizaciones” | Normal: updater solo en app empaquetada |
| Planta no conecta al worker | Revisa `.env` en **AppData**, no el del repo |
| Deploy pide contraseña cada vez | Falta `C:\KEY\release.env` o usa `npm run deploy` |

---

## Resumen en una línea

**Dev:** `npm run dev` · **Listo para planta:** sube `version` → `deploy-release.bat` · **Validar updater:** app instalada, no Electron en dev.
