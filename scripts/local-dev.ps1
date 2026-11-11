# Arranque local en Windows (equivalente a scripts/local-dev.sh sin Docker).
# Requiere PostgreSQL instalado como servicio y un archivo .env en la raíz.
#   powershell -ExecutionPolicy Bypass -File scripts/local-dev.ps1
$ErrorActionPreference = 'Stop'
$projectDir = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $projectDir

if (-not (Test-Path .env)) { throw 'Falta .env en la raíz del proyecto.' }
Get-Content .env | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { Set-Item "env:$($matches[1])" $matches[2].Trim('"') }
}

if (-not $env:LIBREOFFICE_BIN) {
  $soffice = 'C:\Program Files\LibreOffice\program\soffice.exe'
  if (Test-Path $soffice) { $env:LIBREOFFICE_BIN = $soffice }
  else { Write-Warning 'LibreOffice no está disponible; instala LibreOffice o configura LIBREOFFICE_BIN para generar PDF.' }
}

$service = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $service) { throw 'No se encontró el servicio de PostgreSQL. Instálalo con: winget install PostgreSQL.PostgreSQL.17' }
if ($service.Status -ne 'Running') {
  Write-Host "Iniciando $($service.Name)..."
  Start-Service $service.Name
}

Write-Host 'Generando cliente y verificando migraciones de la base local...'
npm run db:generate
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm run db:deploy
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npm run dev:apps
