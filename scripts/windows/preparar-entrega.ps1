# Arma la carpeta que se lleva (USB/ZIP) a la PC del cliente:
#   <Destino>\INSTALAR-TABELIO.cmd   doble clic para instalar
#   <Destino>\tabelio\               código de la aplicación (sin node_modules, builds ni secretos)
#   <Destino>\respaldo\              respaldo de base de datos y documentos (crear-respaldo.ps1)
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\preparar-entrega.ps1 -Destino E:\Entrega-Clerc
param(
  [Parameter(Mandatory)] [string]$Destino,
  [string]$ArchivoEnv,
  [switch]$SinRespaldo,
  [switch]$SoloBaseDeDatos
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\comun.ps1')

$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
New-Item -ItemType Directory -Force -Path $Destino | Out-Null
Set-TabelioLog (Join-Path $Destino 'preparar-entrega.log')

Write-Titulo 'Copiando el código de Tabelio'
$excludeDirs = @('node_modules', '.git', '.next', 'dist', '.import-work', 'backups', 'storage', 'tmp', '.certificates', '.turbo', '.cache', '.vercel', '.codex', '.bob', '.claude')
$excludeFiles = @('.env', '.env.*', '*.log', '*.tsbuildinfo')
$copy = Invoke-Native 'robocopy.exe' (@($projectDir, (Join-Path $Destino 'tabelio'), '/MIR', '/R:2', '/W:2', '/NP', '/NFL', '/NDL', '/XD') + $excludeDirs + @('/XF') + $excludeFiles)
if ($copy.ExitCode -ge 8) { throw "robocopy falló con código $($copy.ExitCode)." }
if (Test-Path (Join-Path $projectDir '.env.example')) { Copy-Item (Join-Path $projectDir '.env.example') (Join-Path $Destino 'tabelio') -Force }
Copy-Item (Join-Path $projectDir 'INSTALAR-TABELIO.cmd') (Join-Path $Destino 'INSTALAR-TABELIO.cmd') -Force
Write-Ok 'Código copiado.'

if (-not $SinRespaldo) {
  $respaldo = Join-Path $Destino 'respaldo'
  if (Test-Path (Join-Path $respaldo 'database.dump')) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    Write-Aviso "Ya existía un respaldo; se renombra a respaldo-$stamp."
    Rename-Item $respaldo "respaldo-$stamp"
  }
  $params = @{ Destino = $respaldo }
  if ($ArchivoEnv) { $params.ArchivoEnv = $ArchivoEnv }
  if ($SoloBaseDeDatos) { $params.SoloBaseDeDatos = $true }
  & (Join-Path $PSScriptRoot 'crear-respaldo.ps1') @params
}

Write-Titulo 'Entrega lista'
Write-Info "Carpeta: $Destino"
Write-Info 'En la PC del cliente: copia la carpeta completa y haz doble clic en INSTALAR-TABELIO.cmd'
