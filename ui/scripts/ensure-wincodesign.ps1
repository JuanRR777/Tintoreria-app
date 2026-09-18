# Prepara signtool de electron-builder sin extraer symlinks (falla sin Modo desarrollador).
# Uso interno desde release-signed.ps1

$ErrorActionPreference = "Stop"

$UiRoot = Split-Path $PSScriptRoot -Parent
$SevenZip = Join-Path $UiRoot "node_modules\7zip-bin\win\x64\7za.exe"
if (-not (Test-Path -LiteralPath $SevenZip)) {
  throw "No se encuentra 7za (npm install en ui): $SevenZip"
}

$CacheRoot = if ($env:ELECTRON_BUILDER_CACHE) { $env:ELECTRON_BUILDER_CACHE } else {
  Join-Path $env:LOCALAPPDATA "electron-builder\Cache"
}
$Dest = Join-Path $CacheRoot "winCodeSign-2.6.0"
$SignTool = Join-Path $Dest "windows-10\x64\signtool.exe"

if (Test-Path -LiteralPath $SignTool) {
  return $SignTool
}

Write-Host "==> Preparando signtool (winCodeSign) en $Dest" -ForegroundColor Cyan

$Archive = $null
$LegacyDir = Join-Path $CacheRoot "winCodeSign"
if (Test-Path -LiteralPath $LegacyDir) {
  $Archive = Get-ChildItem -LiteralPath $LegacyDir -Filter "*.7z" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
}
if (-not $Archive) {
  $Tmp7z = Join-Path $env:TEMP "winCodeSign-2.6.0.7z"
  $Url = "https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z"
  Write-Host "==> Descargando $Url"
  Invoke-WebRequest -Uri $Url -OutFile $Tmp7z -UseBasicParsing
  $Archive = Get-Item -LiteralPath $Tmp7z
}

New-Item -ItemType Directory -Path $Dest -Force | Out-Null
# -snld: enlaces simbolicos como copia; fallan macOS dylibs pero windows-10\x64\signtool.exe queda OK
& $SevenZip x $Archive.FullName "-o$Dest" -y -snld | Out-Null
if ($LASTEXITCODE -gt 1) {
  throw "7za fallo al extraer winCodeSign (codigo $LASTEXITCODE)"
}
if (-not (Test-Path -LiteralPath $SignTool)) {
  throw "Tras extraer no existe: $SignTool"
}

Write-Host "==> signtool listo: $SignTool"
return $SignTool
