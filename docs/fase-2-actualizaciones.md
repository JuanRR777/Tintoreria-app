# Fase 2 — Actualizaciones automáticas (electron-updater)

La app **instalada** puede buscar nuevas versiones publicadas en **GitHub Releases**, descargar el instalador y reiniciar para aplicar el cambio. **No** afecta a `npm start` en desarrollo.

## Requisito único en planta (una vez)

Los equipos que hoy tienen la build **Fase 1** (sin updater) deben instalar **una vez** un `.exe` generado **después** de activar Fase 2. A partir de esa versión, las siguientes actualizaciones se hacen desde **Configuración → Aplicación → Buscar actualizaciones**.

`%LOCALAPPDATA%\Tintoreria\.env` **no se borra** al actualizar.

---

## Git + GitHub desde cero (lo que toca hacer primero)

Hoy la carpeta **no es un repositorio Git**. Las actualizaciones automáticas buscan archivos en **GitHub Releases** del repo que declares en `ui/package.json` → `build.publish`. Sin repo y sin releases, **Buscar actualizaciones** fallará (es normal hasta completar estos pasos).

### 1. Crear el repositorio en GitHub

1. Entra a [github.com](https://github.com) con la cuenta que usarás (p. ej. `proyectos641`).
2. **New repository**:
   - Nombre: p. ej. `produccion2026` (debe coincidir con `owner` / `repo` en `package.json`).
   - **Recomendado: Public** — con repo **privado**, los PCs en planta no pueden descargar releases sin un token embebido en la app (no lo usamos en Fase 2).
   - No marques “Add a README” si vas a subir este proyecto ya existente.

Anota la URL: `https://github.com/proyectos641/produccion2026.git` (ajusta owner/nombre si cambias).

### 2. Inicializar Git en tu PC (una sola vez)

En PowerShell, desde la raíz del proyecto (`produccion2026`):

```powershell
cd C:\Users\DESARROLLADOR\Documents\produccion2026
git init
git add .
git status
```

Revisa que **no** aparezca `api/.env` (contiene secretos). El `.gitignore` ya ignora `.env` y `*.env` salvo `.env.example`.

```powershell
git commit -m "Initial commit: tintoreria local + worker + empaquetado Electron"
git branch -M main
git remote add origin https://github.com/proyectos641/produccion2026.git
git push -u origin main
```

(Si GitHub pide login, usa **Personal Access Token** como contraseña, no la clave de la cuenta.)

### 3. Alinear `ui/package.json` con el repo real

Si el owner o nombre del repo **no** son `proyectos641` / `produccion2026`, edita:

- `"repository"."url"`
- `"build"."publish"."owner"`
- `"build"."publish"."repo"`

La app instalada consultará:  
`https://github.com/{owner}/{repo}/releases/latest`

### 4. Token para **publicar** releases (solo en tu PC de build)

1. GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**.
2. **Generate new token** → permiso **`repo`** (repositorio privado) o **`public_repo`** (solo si el repo es público).
3. Copia el token (`ghp_...`); no lo subas a Git.

Solo lo usas al ejecutar `npm run release` en tu máquina de desarrollo:

```powershell
cd ui
$env:GH_TOKEN = "ghp_tu_token_aqui"
npm run release
```

Eso crea la **Release** en GitHub, el tag `v1.0.0` (según `version` en `package.json`) y sube:

- `Tintoreria de Hilos Setup 1.0.0.exe`
- `latest.yml` (obligatorio para el updater)

### 5. Primera release vs siguientes

| Momento | Qué haces |
|--------|-----------|
| **Primera vez** | Instala en planta el `.exe` de esa release (Fase 2 con updater). Sin release en GitHub, no hay nada que actualizar. |
| **Parche nuevo** | Sube `version` (1.0.0 → 1.0.1), commit/push opcional del código, `npm run release` otra vez. En planta: **Configuración → Aplicación → Buscar actualizaciones**. |

**Release manual** (sin `npm run release`): `npm run dist`, luego en GitHub → **Releases** → **Draft a new release** → tag `v1.0.0` → adjunta `ui/dist/Tintoreria de Hilos Setup 1.0.0.exe` y `ui/dist/latest.yml`.

### 6. Flujo habitual de trabajo (resumen)

```text
Cambios en código → commit + push a GitHub (historial)
                 → subir version en ui/package.json
                 → npm run release (con GH_TOKEN)
                 → PCs en planta: Buscar actualizaciones
```

Git guarda **código**; GitHub **Releases** guarda los **.exe** que consume electron-updater. Son complementarios.

---

## Configurar el repositorio de releases

En `ui/package.json`:

1. **`version`**: sube en cada release (semver), p. ej. `1.0.0` → `1.0.1`.
2. **`repository`** y **`build.publish`**: deben apuntar al repo de GitHub donde publicarás:

```json
"repository": {
  "type": "git",
  "url": "https://github.com/TU_ORG/TU_REPO.git"
},
"build": {
  "publish": {
    "provider": "github",
    "owner": "TU_ORG",
    "repo": "TU_REPO"
  }
}
```

Por defecto el proyecto usa `proyectos641/produccion2026`; cámbialo si tu repo tiene otro nombre.

---

## Publicar una versión nueva (desde tu PC de desarrollo)

1. Sube el código y **aumenta** `version` en `ui/package.json`.
2. Crea un **Personal Access Token** de GitHub con permiso `repo` (o `public_repo` si el repo es público).
3. En PowerShell:

```powershell
cd ui
npm install
$env:GH_TOKEN = "ghp_xxxxxxxx"
npm run release
```

Eso ejecuta `build:runtime`, genera el instalador NSIS y sube a GitHub Release:

- `Tintoreria de Hilos Setup x.y.z.exe`
- `latest.yml` (metadatos que usa electron-updater)

**Alternativa manual:** `npm run dist` y sube a mano los archivos anteriores a una Release etiquetada `vX.Y.Z` (la etiqueta debe coincidir con la versión).

---

## En cada PC de planta

1. Abrir la app → **Configuración** → pestaña **Aplicación**.
2. **Buscar actualizaciones** → si hay versión nueva → **Descargar** → **Reiniciar e instalar**.

Si no hay release en GitHub o el repo/token está mal configurado, verás un mensaje de error en pantalla y en `%LOCALAPPDATA%\Tintoreria\logs\electron-boot.log`.

---

## Checklist Fase 2

- [ ] Repo GitHub creado y `build.publish` apunta al repo correcto
- [ ] Primera release publicada (`npm run release` o Release manual con `.exe` + `latest.yml`)
- [ ] PC de prueba con build Fase 2 instalada
- [ ] Subir `version`, publicar `1.0.1` (o similar) y actualizar desde **Aplicación** sin copiar el `.exe` a mano
- [ ] `npm start` en dev sigue funcionando

---

## Notas

- **Repo privado:** además de `GH_TOKEN` al publicar, en el cliente puede hacer falta configurar acceso a releases privadas (token en el updater); para Fase 2 inicial se asume repo **público** o releases públicas.
- **Sin firma de código:** igual que Fase 1; SmartScreen puede avisar en cada instalador descargado.
- **Cambios grandes** (Python embed, estructura NSIS): si algún día el updater falla, siempre puedes volver a instalar el `.exe` manualmente.
