# Firma interna (certificado autofirmado 5 años)

Certificado de **código** para instaladores `.exe` en PCs de planta donde instalaste el `.cer`.

## Archivos

| Archivo | Ubicación | Uso |
|---------|-----------|-----|
| `KEY.pfx` | Solo PC de build (`C:\KEY\KEY.pfx`) | Firmar con `electron-builder` |
| `KEY.cer` | Copiar a cada PC de planta | Confianza del publicador |

**Nunca** subas el `.pfx` a Git ni a GitHub.

## Publicar release firmada

### Despliegue en un clic (recomendado)

1. Una sola vez: copia `ui/release.secrets.example.env` → **`C:\KEY\release.env`** y rellena `GH_TOKEN` y `CSC_KEY_PASSWORD`.
2. Sube la versión en `ui/package.json` cuando toque un release nuevo.
3. Ejecuta **`ui\deploy-release.bat`** (doble clic) o desde `ui`: **`npm run deploy`**.

No hace falta escribir `$env:GH_TOKEN` ni la contraseña del PFX en cada deploy.

### Qué es cada cosa

| Variable | Qué es | Dónde la defines |
|----------|--------|------------------|
| **CSC_LINK** | Ruta al archivo **KEY.pfx** | El script ya usa `C:\KEY\KEY.pfx`. Solo cambia con `$env:CSC_LINK = "..."` si guardaste el PFX en otro sitio. |
| **CSC_KEY_PASSWORD** | Contraseña que pusiste al **exportar** el PFX | Ver abajo (no va en Git). |

### Contraseña **con caracteres especiales** (`&`, `$`, `!`, `@`, etc.)

**Recomendado** (contraseña con símbolos): ejecuta el script **directo**, no `npm run`:

```powershell
cd C:\Users\DESARROLLADOR\Documents\produccion2026\ui
$env:GH_TOKEN = "ghp_tu_token"
.\scripts\release-signed.ps1
```

Te pedirá `Contrasena:` — escribe la del PFX y Enter.

`npm run release:signed` a veces **no muestra** el prompt; usa `.\scripts\release-signed.ps1`.

### Error al extraer `winCodeSign` (exit status 2 / privilegio de symlink)

electron-builder descarga `winCodeSign` y a veces falla al crear enlaces simbólicos (*El cliente no dispone de un privilegio requerido*). El script `release-signed.ps1` llama a `ensure-wincodesign.ps1`, extrae solo lo necesario con `7za -snld` y define **`SIGNTOOL_PATH`** para no repetir ese fallo.

Alternativa permanente en el PC de build: **Configuración → Privacidad y seguridad → Para desarrolladores → Modo de desarrollador** (permite symlinks).

### Contraseña simple (sin caracteres raros)

```powershell
$env:CSC_KEY_PASSWORD = "mi_clave"
$env:GH_TOKEN = "ghp_tu_token"
npm run release:signed
```

En PowerShell, si hay símbolos, usa **comillas simples** (literal):

```powershell
$env:CSC_KEY_PASSWORD = 'mi&clave$123'
```

### `publisherName` (obligatorio con certificado autofirmado)

En `ui/package.json` → `build.win.publisherName` y `build.publish.publisherName` debe coincidir con el **CN** o **O** del certificado (ver `certmgr.msc` → Personal → tu certificado → Detalles → Sujeto).

Ahora está en **`Tintoreria Interno`**. Si al crear el certificado usaste otro nombre (p. ej. `Tintoreria Interno`), cámbialo en esos dos sitios.

Ruta distinta al PFX:

```powershell
$env:CSC_LINK = "C:\KEY\KEY.pfx"
```

En los logs debe aparecer `signing with signtool.exe` **sin** `signing is skipped`.

## Instalar confianza en planta

1. Copia el `.cer` al PC.
2. Doble clic → **Instalar certificado** → **Equipo local** (admin).
3. **Colocar en**: **Publicadores de confianza** (y si hace falta también **Entidades emisoras raíz de confianza**).

Reinicia la app o el PC si Windows sigue mostrando “editor desconocido”.

## Build sin firmar (como antes)

```powershell
npm run release
```

(sin `CSC_LINK` / `CSC_KEY_PASSWORD`)
