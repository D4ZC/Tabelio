# Vigilante de Tabelio: inicia PostgreSQL, la API y la web, y las reinicia si se detienen.
# Lo ejecuta la tarea programada "Tabelio" (cuenta SYSTEM) al encender la PC.
#   powershell -NoProfile -ExecutionPolicy Bypass -File iniciar-tabelio.ps1 -RaizInstalacion C:\Tabelio
param(
  [string]$RaizInstalacion = 'C:\Tabelio'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\comun.ps1')

$configPath = Join-Path $RaizInstalacion 'config\instalacion.json'
if (-not (Test-Path $configPath)) { throw "No existe $configPath. Ejecuta primero el instalador." }
$config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
Set-TabelioLog (Join-Path $config.logsDir 'vigilante.log')

# Una sola instancia del vigilante a la vez.
$mutex = New-Object System.Threading.Mutex($false, 'Global\TabelioVigilante')
if (-not $mutex.WaitOne(0)) { Write-Log 'Ya hay un vigilante en ejecución; se termina esta instancia.'; exit 0 }

function Start-Postgres {
  $service = Get-Service -Name $config.pgService -ErrorAction SilentlyContinue
  if (-not $service) { Write-Log "No existe el servicio $($config.pgService)."; return $false }
  if ($service.StartType -eq 'Disabled') { Set-Service -Name $config.pgService -StartupType Automatic }
  if ($service.Status -ne 'Running') {
    Write-Log "Iniciando $($config.pgService)..."
    try { Start-Service -Name $config.pgService } catch { Write-Log "No se pudo iniciar PostgreSQL: $($_.Exception.Message)" }
  }
  for ($i = 0; $i -lt 30; $i++) {
    if (-not (Test-PuertoLibre $config.pgPort)) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Rotate-Log([string]$Path) {
  if ((Test-Path $Path) -and ((Get-Item $Path).Length -gt 20MB)) {
    Move-Item -Force $Path "$Path.anterior"
  }
}

function Start-Componente([string]$Nombre) {
  $envValues = Read-DotEnv (Join-Path $config.appDir '.env')
  foreach ($key in $envValues.Keys) { [Environment]::SetEnvironmentVariable($key, $envValues[$key], 'Process') }
  $env:NODE_ENV = 'production'
  if ($Nombre -eq 'api') {
    $env:API_PORT = [string]$config.apiPort
    $workDir = Join-Path $config.appDir 'apps\api'
    $arguments = @('"' + (Join-Path $workDir 'dist\main.js') + '"')
  } else {
    $env:PORT = [string]$config.webPort
    $env:HOSTNAME = '127.0.0.1'
    $env:API_PROXY_TARGET = "http://127.0.0.1:$($config.apiPort)/api"
    $workDir = Split-Path $config.webServer -Parent
    $arguments = @('"' + $config.webServer + '"')
  }
  $out = Join-Path $config.logsDir "$Nombre.log"
  $err = Join-Path $config.logsDir "$Nombre-errores.log"
  Rotate-Log $out; Rotate-Log $err
  Write-Log "Iniciando $Nombre..."
  return Start-Process -FilePath $config.nodeExe -ArgumentList $arguments -WorkingDirectory $workDir `
    -RedirectStandardOutput $out -RedirectStandardError $err -NoNewWindow -PassThru
}

# Si quedaron procesos de una ejecución anterior (p. ej. el vigilante murió), se detienen para liberar puertos.
Get-TabelioNodeProcesses $config.appDir | ForEach-Object {
  Write-Log "Deteniendo proceso previo $($_.ProcessId)"
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

if (-not (Start-Postgres)) { Write-Log 'PostgreSQL no respondió; se reintentará en el ciclo de vigilancia.' }

$procesos = @{ api = $null; web = $null }
$fallos = @{ api = 0; web = 0 }
while ($true) {
  foreach ($nombre in @('api', 'web')) {
    $proc = $procesos[$nombre]
    if ($null -eq $proc -or $proc.HasExited) {
      if ($proc) {
        $fallos[$nombre]++
        Write-Log "$nombre se detuvo (código $($proc.ExitCode)); reinicio #$($fallos[$nombre])."
        Start-Postgres | Out-Null
        # Espera progresiva para no saturar la PC si hay un error permanente.
        Start-Sleep -Seconds ([Math]::Min(60, 5 * $fallos[$nombre]))
      }
      try { $procesos[$nombre] = Start-Componente $nombre } catch { Write-Log "No se pudo iniciar ${nombre}: $($_.Exception.Message)" }
    } elseif ($fallos[$nombre] -gt 0 -and ((Get-Date) - $proc.StartTime).TotalMinutes -gt 10) {
      $fallos[$nombre] = 0
    }
  }
  Start-Sleep -Seconds 10
}
