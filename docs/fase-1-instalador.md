# Fase 1 — Instalador Windows (.exe)

Objetivo: generar un instalador que incluye Electron, la UI, Python portable y la API FastAPI. **No** incluye auto-actualización (Fase 2).

## Requisitos para compilar

- Windows 10/11 x64
- Node.js (para `npm` en `ui/`)
- Internet (descarga Python embed y pip en el primer `build:runtime`)

## Generar el instalador

```powershell
cd ui
npm install
npm run dist
```

Salida:

- `ui/dist/Tintoreria de Hilos Setup 1.0.0.exe` (nombre según versión en `package.json`)

Prueba rápida sin instalador:

```powershell
npm run dist:dir
```

Abre `ui/dist/win-unpacked/Tintoreria de Hilos.exe`.

## Configuración en planta (primera vez)

Al abrir la app instalada se crea:

`%LOCALAPPDATA%\Tintoreria\.env`

(copia de `.env.example` si no existía). Edita ese archivo:

```env
WORKER_URL=https://tu-worker.workers.dev
WORKER_API_KEY=tu-clave
```

Reinicia la aplicación.

## Logs

| Modo | Electron | API Python |
|------|----------|------------|
| Desarrollo (`npm start`) | `electron-boot.log` en la raíz del repo | `api/startup.log` |
| Instalado | `%LOCALAPPDATA%\Tintoreria\logs\electron-boot.log` | `%LOCALAPPDATA%\Tintoreria\logs\api-startup.log` |

## Checklist de validación (PROYECTOS)

Marca cuando hayas comprobado cada punto:

- [ ] `npm run dist` termina sin errores
- [ ] Instalador probado en un PC **sin** depender de Node/Python en PATH (ideal: otra máquina o usuario)
- [ ] `.env` en AppData con `WORKER_URL` y `WORKER_API_KEY` correctos
- [ ] La app abre y `/health` responde (login funciona)
- [ ] Stock / Solicitudes cargan datos desde D1
- [ ] (Opcional) Báscula / puerto serie en ese equipo
- [ ] `npm start` en el repo de desarrollo **sigue** funcionando

Cuando todos los ítems aplicables estén marcados, la **Fase 1** está lista.

**Fase 2 (actualizaciones):** ver [fase-2-actualizaciones.md](./fase-2-actualizaciones.md).

## Desarrollo vs instalado

| | Desarrollo | Instalado |
|---|------------|-----------|
| Python | `api/.venv` | `resources/python/python.exe` |
| API | `api/` del repo | `resources/api/` |
| Variables | `api/.env` | `%LOCALAPPDATA%\Tintoreria\.env` |

## SmartScreen

Sin certificado de código, Windows puede mostrar advertencia al instalar. Usar **Más información → Ejecutar de todas formas** en entornos de prueba.

## Error al compilar (symlink / winCodeSign)

Si `electron-builder` falla con *El cliente no dispone de un privilegio requerido* al extraer `winCodeSign`, el proyecto ya desactiva firma automática (`signAndEditExecutable: false` y `CSC_IDENTITY_AUTO_DISCOVERY=false` en el script `dist`). Vuelve a ejecutar `npm run dist`. Alternativa: terminal **como administrador** o activar *Modo desarrollador* en Windows (permite symlinks).

## Idiomas del instalador NSIS

En `package.json` → `build.nsis.installerLanguages` usa códigos válidos de electron-builder (p. ej. `es_ES`, `en_US`). No uses `es-419` ni nombres sueltos como `Spanish` (NSIS los rechaza).
