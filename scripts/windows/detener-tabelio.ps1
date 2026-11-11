# Detiene Tabelio (tarea programada, API y web). PostgreSQL se deja encendido.
#   powershell -NoProfile -ExecutionPolicy Bypass -File detener-tabelio.ps1 [-Reiniciar]
param(
  [string]$RaizInstalacion = 'C:\Tabelio',
  [switch]$Reiniciar
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\comun.ps1')

$config = Get-Content (Join-Path $RaizInstalacion 'config\instalacion.json') -Raw -Encoding UTF8 | ConvertFrom-Json
try { Stop-ScheduledTask -TaskName 'Tabelio' -ErrorAction Stop } catch { }
Get-TabelioNodeProcesses $config.appDir | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host 'Tabelio detenido.'

if ($Reiniciar) {
  Start-ScheduledTask -TaskName 'Tabelio'
  Write-Host 'Reiniciando Tabelio...'
  if (Wait-Url "http://127.0.0.1:$($config.webPort)/login" 180) {
    Write-Host 'Tabelio está listo.' -ForegroundColor Green
    Start-Process "http://localhost:$($config.webPort)"
  } else {
    Write-Host "Tabelio no respondió. Revisa los registros en $($config.logsDir)" -ForegroundColor Yellow
  }
}
