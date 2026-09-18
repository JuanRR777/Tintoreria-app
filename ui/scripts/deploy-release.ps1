# Despliegue firmado a GitHub Releases (un solo paso).
# Configura secretos una vez en C:\KEY\release.env (ver release.secrets.example.env).

param(
  [string]$SecretsFile = $env:RELEASE_SECRETS_FILE
)

$ErrorActionPreference = "Stop"
$UiRoot = Split-Path $PSScriptRoot -Parent

if ([string]::IsNullOrWhiteSpace($SecretsFile)) {
  foreach ($candidate in @(
      "C:\KEY\release.env",
      (Join-Path $UiRoot "release.secrets.env")
    )) {
    if (Test-Path -LiteralPath $candidate) {
      $SecretsFile = $candidate
      break
    }
  }
}

if ([string]::IsNullOrWhiteSpace($SecretsFile) -or -not (Test-Path -LiteralPath $SecretsFile)) {
  Write-Host ""
  Write-Host "Falta el archivo de secretos." -ForegroundColor Red
  Write-Host "  1. Copia ui\release.secrets.example.env -> C:\KEY\release.env"
  Write-Host "  2. Edita GH_TOKEN y CSC_KEY_PASSWORD"
  Write-Host ""
  exit 1
}

function Set-EnvFromLine {
  param([string]$Line)
  $t = $Line.Trim()
  if ($t.Length -eq 0 -or $t.StartsWith("#")) { return }
  $eq = $t.IndexOf("=")
  if ($eq -lt 1) { return }
  $name = $t.Substring(0, $eq).Trim()
  $value = $t.Substring($eq + 1).Trim()
  if ($value.Length -ge 2) {
    $q = $value[0]
    if (($q -eq '"' -or $q -eq "'") -and $value[$value.Length - 1] -eq $q) {
      $value = $value.Substring(1, $value.Length - 2)
    }
  }
  Set-Item -Path "Env:$name" -Value $value
}

Get-Content -LiteralPath $SecretsFile -Encoding UTF8 | ForEach-Object { Set-EnvFromLine $_ }

if ([string]::IsNullOrWhiteSpace($env:GH_TOKEN)) {
  Write-Warning "GH_TOKEN vacio en $SecretsFile"
}
if ([string]::IsNullOrWhiteSpace($env:CSC_KEY_PASSWORD)) {
  throw "CSC_KEY_PASSWORD vacio en $SecretsFile"
}

Write-Host "==> Despliegue (version en package.json)" -ForegroundColor Green
Write-Host "==> Secretos: $SecretsFile"

& (Join-Path $PSScriptRoot "release-signed.ps1") -UseEnvPassword
exit $LASTEXITCODE
