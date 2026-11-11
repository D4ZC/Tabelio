# Funciones compartidas por los scripts de instalación y operación de Tabelio en Windows.
# Compatible con Windows PowerShell 5.1 (no usar ??, ?:, && ni ||).

$script:LogFile = $null

function Set-TabelioLog([string]$Path) {
  $dir = Split-Path $Path -Parent
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $script:LogFile = $Path
}

function Write-Log([string]$Message) {
  if ($script:LogFile) {
    $line = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $Message
    try { Add-Content -LiteralPath $script:LogFile -Value $line -Encoding UTF8 } catch { }
  }
}

function Write-Titulo([string]$Texto) {
  Write-Host ''
  Write-Host ('=' * 70) -ForegroundColor DarkCyan
  Write-Host "  $Texto" -ForegroundColor Cyan
  Write-Host ('=' * 70) -ForegroundColor DarkCyan
  Write-Log "=== $Texto"
}
function Write-Info([string]$Texto) { Write-Host "  $Texto"; Write-Log "INFO  $Texto" }
function Write-Ok([string]$Texto) { Write-Host "  [OK] $Texto" -ForegroundColor Green; Write-Log "OK    $Texto" }
function Write-Aviso([string]$Texto) { Write-Host "  [AVISO] $Texto" -ForegroundColor Yellow; Write-Log "AVISO $Texto" }
function Write-Fallo([string]$Texto) { Write-Host "  [ERROR] $Texto" -ForegroundColor Red; Write-Log "ERROR $Texto" }

function Update-SessionPath {
  # Los instaladores modifican el PATH del sistema; la sesión actual no lo ve hasta recargarlo.
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ';'
}

function Test-Administrador {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Read-DotEnv([string]$Path) {
  $values = [ordered]@{}
  if (-not (Test-Path -LiteralPath $Path)) { return $values }
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
      $value = $matches[2].Trim()
      if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      $values[$matches[1]] = $value
    }
  }
  return $values
}

function Invoke-Native {
  # Ejecuta un programa externo mostrando y registrando su salida sin que stderr aborte el script.
  param(
    [Parameter(Mandatory)] [string]$FilePath,
    [string[]]$Arguments = @(),
    [string]$WorkingDirectory,
    [hashtable]$Environment = @{},
    [switch]$Quiet,
    [string[]]$Mask = @()
  )
  $previousEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $savedEnv = @{}
  foreach ($key in $Environment.Keys) {
    $savedEnv[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
    [Environment]::SetEnvironmentVariable($key, [string]$Environment[$key], 'Process')
  }
  if ($WorkingDirectory) { Push-Location -LiteralPath $WorkingDirectory }
  $lines = New-Object System.Collections.Generic.List[string]
  $display = "$FilePath $($Arguments -join ' ')"
  foreach ($secret in $Mask) { if ($secret) { $display = $display.Replace($secret, '****') } }
  Write-Log "EXEC  $display"
  try {
    & $FilePath @Arguments 2>&1 | ForEach-Object {
      $text = "$_"
      foreach ($secret in $Mask) { if ($secret) { $text = $text.Replace($secret, '****') } }
      $lines.Add($text)
      Write-Log "      $text"
      if (-not $Quiet) { Write-Host "      $text" -ForegroundColor DarkGray }
    }
    $code = $LASTEXITCODE
    if ($null -eq $code) { $code = 0 }
  } catch {
    $lines.Add($_.Exception.Message)
    Write-Log "      $($_.Exception.Message)"
    $code = -1
  } finally {
    if ($WorkingDirectory) { Pop-Location }
    foreach ($key in $savedEnv.Keys) { [Environment]::SetEnvironmentVariable($key, $savedEnv[$key], 'Process') }
    $ErrorActionPreference = $previousEap
  }
  return [pscustomobject]@{ ExitCode = $code; Output = ($lines -join "`n") }
}

function Test-PuertoLibre([int]$Port) {
  $listener = $null
  try {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
    $listener.Start()
    return $true
  } catch { return $false } finally { if ($listener) { $listener.Stop() } }
}

function Wait-Url([string]$Url, [int]$TimeoutSeconds = 120) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) { return $true }
    } catch { }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Get-TabelioNodeProcesses([string]$AppDir) {
  $prefix = [IO.Path]::GetFullPath($AppDir).TrimEnd('\')
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($prefix, [StringComparison]::OrdinalIgnoreCase) -ge 0 }
}
