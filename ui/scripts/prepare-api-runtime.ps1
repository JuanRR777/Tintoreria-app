# Empaqueta Python embeddable + dependencias + codigo api/ para electron-builder (Windows x64).
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$UiDir = Split-Path -Parent $ScriptDir
$Root = Split-Path -Parent $UiDir
$ApiSrc = Join-Path $Root "api"
$BuildDir = Join-Path $UiDir "build"
$PythonDir = Join-Path $BuildDir "python"
$ApiOut = Join-Path $BuildDir "api"
$CacheDir = Join-Path $BuildDir "cache"
$PyVer = "3.12.7"
$EmbedName = "python-$PyVer-embed-amd64.zip"
$EmbedUrl = "https://www.python.org/ftp/python/$PyVer/$EmbedName"
$GetPipUrl = "https://bootstrap.pypa.io/get-pip.py"

function Ensure-Dir($p) {
  if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p -Force | Out-Null }
}

Write-Host "==> Preparando runtime en $BuildDir"

if (-not (Test-Path (Join-Path $ApiSrc "main.py"))) {
  throw "No se encontro api/main.py (root=$Root)"
}

Ensure-Dir $BuildDir
Ensure-Dir $CacheDir

if (Test-Path $PythonDir) { Remove-Item $PythonDir -Recurse -Force }
if (Test-Path $ApiOut) { Remove-Item $ApiOut -Recurse -Force }
Ensure-Dir $PythonDir
Ensure-Dir $ApiOut

$ZipPath = Join-Path $CacheDir $EmbedName
if (-not (Test-Path $ZipPath)) {
  Write-Host "==> Descargando Python embed $PyVer ..."
  Invoke-WebRequest -Uri $EmbedUrl -OutFile $ZipPath -UseBasicParsing
}

Write-Host "==> Extrayendo Python embed ..."
Expand-Archive -Path $ZipPath -DestinationPath $PythonDir -Force

$PthFile = Get-ChildItem -Path $PythonDir -Filter "python*._pth" | Select-Object -First 1
if (-not $PthFile) { throw "No se encontro python*._pth en $PythonDir" }

$SiteDir = Join-Path $PythonDir "Lib\site-packages"
Ensure-Dir $SiteDir

$PthLines = @(
  "python312.zip",
  ".",
  "Lib\site-packages",
  "",
  "import site"
)
Set-Content -Path $PthFile.FullName -Value $PthLines -Encoding ASCII

$PythonExe = Join-Path $PythonDir "python.exe"
$GetPip = Join-Path $CacheDir "get-pip.py"
if (-not (Test-Path $GetPip)) {
  Write-Host "==> Descargando get-pip.py ..."
  Invoke-WebRequest -Uri $GetPipUrl -OutFile $GetPip -UseBasicParsing
}

Write-Host "==> Instalando pip ..."
& $PythonExe $GetPip --no-warn-script-location
if ($LASTEXITCODE -ne 0) { throw "get-pip fallo con codigo $LASTEXITCODE" }

$ReqFile = Join-Path $ApiSrc "requirements.txt"
Write-Host "==> Instalando dependencias API ..."
& $PythonExe -m pip install --no-warn-script-location -r $ReqFile
if ($LASTEXITCODE -ne 0) { throw "pip install fallo con codigo $LASTEXITCODE" }

$ScriptsDir = Join-Path $PythonDir "Scripts"
if (Test-Path $ScriptsDir) {
  Write-Host "==> Limpiando Scripts/ (no necesario en runtime) ..."
  Remove-Item $ScriptsDir -Recurse -Force
}

Write-Host "==> Copiando codigo api ..."
$ExcludeDirs = @(".venv", "venv", "env", "data", "__pycache__", ".pytest_cache")
Get-ChildItem -Path $ApiSrc -Force | ForEach-Object {
  $name = $_.Name
  if ($ExcludeDirs -contains $name) { return }
  if ($name -eq ".env") { return }
  if ($name -like "*.log") { return }
  if ($name -like "*.db*") { return }
  $dest = Join-Path $ApiOut $name
  if ($_.PSIsContainer) {
    Copy-Item -Path $_.FullName -Destination $dest -Recurse -Force
  } else {
    Copy-Item -Path $_.FullName -Destination $dest -Force
  }
}

# Limpia __pycache__ dentro del destino
Get-ChildItem -Path $ApiOut -Recurse -Directory -Filter "__pycache__" -ErrorAction SilentlyContinue |
  ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }

if (-not (Test-Path (Join-Path $ApiOut ".env.example"))) {
  throw "Falta api/.env.example en el bundle"
}

Write-Host "==> Listo: $PythonDir"
Write-Host "==> Listo: $ApiOut"
