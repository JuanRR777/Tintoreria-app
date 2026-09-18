# Publica release firmada con PFX local (electron-builder).
# Manual: .\scripts\release-signed.ps1
# Automatico: doble clic deploy-release.bat o npm run deploy

param(
  [switch]$UseEnvPassword
)

$ErrorActionPreference = "Stop"
$UiRoot = Split-Path $PSScriptRoot -Parent
Set-Location $UiRoot

$PfxPath = if ($env:CSC_LINK) { $env:CSC_LINK } else { "C:\KEY\KEY.pfx" }
if (-not (Test-Path -LiteralPath $PfxPath)) {
  throw "No se encuentra el PFX: $PfxPath (define CSC_LINK si esta en otra ruta)"
}

$pass = $null
if ($UseEnvPassword -and -not [string]::IsNullOrWhiteSpace($env:CSC_KEY_PASSWORD)) {
  $pass = $env:CSC_KEY_PASSWORD
  Write-Host "Usando CSC_KEY_PASSWORD del entorno."
} else {
  Remove-Item Env:CSC_KEY_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:WIN_CSC_KEY_PASSWORD -ErrorAction SilentlyContinue
  Write-Host ""
  Write-Host "=== Contrasena del PFX ===" -ForegroundColor Cyan
  Write-Host "Archivo: $PfxPath"
  $pass = Read-Host "Contrasena"
  if ([string]::IsNullOrWhiteSpace($pass)) {
    throw "Contrasena vacia. Cancelado."
  }
}

if (-not $env:GH_TOKEN) {
  Write-Warning "GH_TOKEN no esta definido: el build se generara pero no se subira a GitHub."
}

$SignTool = & (Join-Path $PSScriptRoot "ensure-wincodesign.ps1")
$env:SIGNTOOL_PATH = $SignTool

$env:CSC_LINK = $PfxPath
$env:CSC_KEY_PASSWORD = $pass
$env:WIN_CSC_LINK = $PfxPath
$env:WIN_CSC_KEY_PASSWORD = $pass
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"

Write-Host "==> Firmando con $PfxPath"
Write-Host "==> SIGNTOOL_PATH=$SignTool"
Write-Host "==> build:runtime + electron-builder --publish always"

npm run build:runtime
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npx electron-builder --win --publish always
exit $LASTEXITCODE
