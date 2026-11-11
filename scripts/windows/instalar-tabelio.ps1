# Instalador de Tabelio para la PC de un cliente (Windows 10/11, 64 bits).
#
# Uso normal: doble clic en INSTALAR-TABELIO.cmd (pide permisos de administrador).
# Manual:     powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\instalar-tabelio.ps1
#
# Qué hace:
#   1. Pide al inicio todo lo necesario (respaldo, carpeta de documentos, credenciales de IA).
#   2. Instala lo que falte: Visual C++, Node.js, PostgreSQL, LibreOffice, Tesseract (español) y Poppler.
#      Cada componente se busca primero en la PC, luego se instala con winget y, si falla, se descarga directo.
#   3. Copia la app a C:\Tabelio\app, genera .env con secretos aleatorios, restaura el respaldo y compila.
#   4. Registra la tarea programada "Tabelio" que la arranca con Windows y crea accesos directos.
#
# Es reanudable: si algo falla, vuelve a ejecutarlo y continúa donde se quedó
# (estado en C:\Tabelio\config\estado.json; usa -ReiniciarEstado para empezar de cero).
param(
  [string]$RaizInstalacion = 'C:\Tabelio',
  [string]$RutaRespaldo,
  [switch]$ReiniciarEstado
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest es muy lento en PS 5.1 con barra de progreso.
. (Join-Path $PSScriptRoot 'lib\comun.ps1')

# --------------------------------------------------------------------------------------------
# Elevación
# --------------------------------------------------------------------------------------------
if (-not (Test-Administrador)) {
  Write-Host 'Se requieren permisos de administrador; abriendo una ventana elevada...'
  $relaunch = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-RaizInstalacion', "`"$RaizInstalacion`"")
  if ($RutaRespaldo) { $relaunch += @('-RutaRespaldo', "`"$RutaRespaldo`"") }
  if ($ReiniciarEstado) { $relaunch += '-ReiniciarEstado' }
  Start-Process powershell.exe -Verb RunAs -ArgumentList $relaunch
  exit 0
}

# --------------------------------------------------------------------------------------------
# Rutas y estado
# --------------------------------------------------------------------------------------------
$Raiz = [IO.Path]::GetFullPath($RaizInstalacion)
$SourceDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$AppDir = Join-Path $Raiz 'app'
$ConfigDir = Join-Path $Raiz 'config'
$LogsDir = Join-Path $Raiz 'logs'
$ToolsDir = Join-Path $Raiz 'herramientas'
$DownloadsDir = Join-Path $Raiz 'descargas'
$PgBinDirOwn = Join-Path $Raiz 'postgresql'
$PgData = Join-Path $Raiz 'postgresql-datos'
$StatePath = Join-Path $ConfigDir 'estado.json'
$SecretsPath = Join-Path $ConfigDir 'secretos.json'
$PgServiceName = 'tabelio-postgresql'
$TaskName = 'Tabelio'
$UserAgent = 'Tabelio-Instalador'
$SidAdmins = '*S-1-5-32-544'; $SidSystem = '*S-1-5-18'; $SidNetworkService = '*S-1-5-20'

foreach ($dir in $Raiz, $ConfigDir, $LogsDir, $ToolsDir, $DownloadsDir) {
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
}
Set-TabelioLog (Join-Path $LogsDir ('instalacion-{0:yyyyMMdd-HHmmss}.log' -f (Get-Date)))

# La carpeta de configuración guarda contraseñas: sólo administradores y SYSTEM.
& icacls.exe $ConfigDir /inheritance:r /grant:r "${SidAdmins}:(OI)(CI)F" "${SidSystem}:(OI)(CI)F" | Out-Null

function Read-JsonHashtable([string]$Path) {
  $table = @{}
  if (Test-Path $Path) {
    $obj = Get-Content $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($p in $obj.PSObject.Properties) { $table[$p.Name] = $p.Value }
  }
  return $table
}
function Write-JsonFile([string]$Path, $Value) {
  [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
}

if ($ReiniciarEstado -and (Test-Path $StatePath)) { Remove-Item $StatePath -Force }
$raw = Read-JsonHashtable $StatePath
$State = @{ completed = New-Object System.Collections.ArrayList; inputs = @{} }
if ($raw.completed) { foreach ($c in $raw.completed) { [void]$State.completed.Add([string]$c) } }
if ($raw.inputs) { foreach ($p in $raw.inputs.PSObject.Properties) { $State.inputs[$p.Name] = $p.Value } }
function Save-State { Write-JsonFile $StatePath $State }

$Secrets = Read-JsonHashtable $SecretsPath
function New-Secreto([int]$Length = 32) {
  $chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'.ToCharArray()
  $bytes = New-Object byte[] $Length
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}
foreach ($k in 'pgSuperPassword', 'dbPassword') { if (-not $Secrets[$k]) { $Secrets[$k] = New-Secreto 32 } }
if (-not $Secrets['jwtSecret']) { $Secrets['jwtSecret'] = New-Secreto 64 }
Write-JsonFile $SecretsPath $Secrets

$script:Omitidos = New-Object System.Collections.ArrayList

# --------------------------------------------------------------------------------------------
# Utilidades de interacción y pasos
# --------------------------------------------------------------------------------------------
function Read-Valor([string]$Pregunta, [string]$Default) {
  $suffix = ''
  if ($Default) { $suffix = " [$Default]" }
  $answer = Read-Host "  $Pregunta$suffix"
  if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
  return $answer.Trim().Trim('"')
}
function Read-SiNo([string]$Pregunta, [bool]$Default = $true) {
  $hint = 's/N'
  if ($Default) { $hint = 'S/n' }
  while ($true) {
    $answer = Read-Host "  $Pregunta ($hint)"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $Default }
    if ($answer -match '^(s|si|sí|y|yes)$') { return $true }
    if ($answer -match '^(n|no)$') { return $false }
  }
}
function Read-Secreto([string]$Pregunta) {
  $secure = Read-Host "  $Pregunta" -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Complete-Step([string]$Id) {
  if (-not $State.completed.Contains($Id)) { [void]$State.completed.Add($Id) }
  Save-State
}

function Invoke-Step {
  # Ejecuta un paso con reintentos y acciones de reparación entre intentos.
  # Si agota los intentos pregunta: reintentar, omitir (sólo pasos opcionales) o cancelar.
  param(
    [string]$Id,
    [string]$Titulo,
    [scriptblock]$Accion,
    [scriptblock]$Reparar,
    [switch]$Opcional,
    [switch]$SiempreEjecutar,
    [int]$Intentos = 3
  )
  Write-Titulo $Titulo
  if (-not $SiempreEjecutar -and $State.completed.Contains($Id)) { Write-Ok 'Ya estaba completado.'; return $true }
  while ($true) {
    for ($i = 1; $i -le $Intentos; $i++) {
      try {
        & $Accion
        Complete-Step $Id
        return $true
      } catch {
        Write-Fallo "Intento $i de ${Intentos}: $($_.Exception.Message)"
        Write-Log $_.ScriptStackTrace
        if ($Reparar -and $i -lt $Intentos) {
          Write-Info 'Aplicando corrección automática antes de reintentar...'
          try { & $Reparar $i } catch { Write-Aviso "La corrección automática no funcionó: $($_.Exception.Message)" }
        }
        if ($i -lt $Intentos) { Start-Sleep -Seconds (5 * $i) }
      }
    }
    Write-Host ''
    if ($Opcional) {
      $answer = Read-Valor "No se pudo completar '$Titulo'. [R]eintentar, [O]mitir este componente o [C]ancelar" 'R'
    } else {
      $answer = Read-Valor "No se pudo completar '$Titulo' (obligatorio). [R]eintentar o [C]ancelar" 'R'
    }
    if ($answer -match '^[Oo]' -and $Opcional) {
      [void]$script:Omitidos.Add($Titulo)
      Write-Aviso "Se omitió: $Titulo"
      return $false
    }
    if ($answer -match '^[Cc]') {
      throw "Instalación cancelada en el paso '$Titulo'. Revisa el registro en $LogsDir y vuelve a ejecutar el instalador para continuar."
    }
  }
}

function Assert-Exit($Result, [string]$Mensaje, [int[]]$Permitidos = @(0)) {
  if ($Permitidos -notcontains $Result.ExitCode) { throw "$Mensaje (código $($Result.ExitCode))" }
}

# --------------------------------------------------------------------------------------------
# Descargas y winget
# --------------------------------------------------------------------------------------------
function Get-Descarga([string]$Url, [string]$Nombre) {
  # Cada descarga va a su propia carpeta nueva. Prueba curl.exe, BITS y Invoke-WebRequest.
  $dir = Join-Path $DownloadsDir ([guid]::NewGuid().ToString('N').Substring(0, 10))
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $dest = Join-Path $dir $Nombre
  Write-Info "Descargando $Url"
  $curl = Join-Path $env:SystemRoot 'System32\curl.exe'
  if (Test-Path $curl) {
    $r = Invoke-Native $curl @('-L', '--fail', '--silent', '--show-error', '--retry', '3', '--retry-delay', '5', '--connect-timeout', '30', '-A', $UserAgent, '-o', $dest, $Url) -Quiet
    if ($r.ExitCode -eq 0 -and (Test-Path $dest) -and (Get-Item $dest).Length -gt 0) { return $dest }
    Write-Aviso 'curl no pudo descargar; probando con BITS.'
  }
  try {
    Start-BitsTransfer -Source $Url -Destination $dest -ErrorAction Stop
    if ((Test-Path $dest) -and (Get-Item $dest).Length -gt 0) { return $dest }
  } catch { Write-Aviso "BITS no pudo descargar: $($_.Exception.Message)" }
  Invoke-WebRequest -Uri $Url -OutFile $dest -UseBasicParsing -UserAgent $UserAgent -TimeoutSec 600
  if ((Test-Path $dest) -and (Get-Item $dest).Length -gt 0) { return $dest }
  throw "No se pudo descargar $Url"
}

function Get-GitHubAsset([string]$Repo, [string]$Patron) {
  $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ 'User-Agent' = $UserAgent } -TimeoutSec 60
  $asset = $release.assets | Where-Object { $_.name -match $Patron } | Select-Object -First 1
  if (-not $asset) { throw "No se encontró un archivo '$Patron' en la última versión de $Repo." }
  return $asset
}

$script:WingetChecked = $false
$script:WingetPath = $null
function Get-Winget {
  if ($script:WingetChecked) { return $script:WingetPath }
  $script:WingetChecked = $true
  $cmd = Get-Command winget.exe -ErrorAction SilentlyContinue
  if (-not $cmd) {
    Write-Info 'winget no está disponible; intentando registrar App Installer...'
    try { Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe -ErrorAction Stop } catch { }
    Update-SessionPath
    $cmd = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $cmd) {
      $candidate = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\winget.exe'
      if (Test-Path $candidate) { $script:WingetPath = $candidate }
    }
  }
  if ($cmd) { $script:WingetPath = $cmd.Source }
  if ($script:WingetPath) {
    Invoke-Native $script:WingetPath @('source', 'update') -Quiet | Out-Null
  } else {
    Write-Aviso 'winget no está disponible; se usarán descargas directas.'
  }
  return $script:WingetPath
}

function Install-ConWinget([string]$Id, [string[]]$Extra = @()) {
  $winget = Get-Winget
  if (-not $winget) { return }
  Write-Info "Instalando $Id con winget..."
  $common = @('install', '--id', $Id, '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements')
  $r = Invoke-Native $winget ($common + @('--scope', 'machine') + $Extra)
  if ($r.ExitCode -ne 0) {
    # Algunos paquetes no ofrecen instalador "machine"; se intenta sin forzar el alcance.
    $r = Invoke-Native $winget ($common + $Extra)
  }
  if ($r.ExitCode -ne 0 -and $r.Output -match 'source|origen|0x8a15000f|0x8a150044') {
    Write-Info 'Restableciendo las fuentes de winget...'
    Invoke-Native $winget @('source', 'reset', '--force') -Quiet | Out-Null
    Invoke-Native $winget ($common + $Extra) | Out-Null
  }
  Update-SessionPath
}

function Install-Msi([string]$Path) {
  $log = "$Path.log"
  $r = Invoke-Native 'msiexec.exe' @('/i', $Path, '/qn', '/norestart', '/L*v', $log) -Quiet
  if (@(0, 1641, 3010) -notcontains $r.ExitCode) {
    if ($r.ExitCode -eq 1618) { throw 'Otra instalación de Windows está en curso; espera a que termine.' }
    throw "msiexec terminó con código $($r.ExitCode). Detalle en $log"
  }
  Update-SessionPath
}

function Wait-MsiLibre {
  # El error 1618 ocurre si Windows Update u otro instalador está usando msiexec.
  for ($i = 0; $i -lt 60; $i++) {
    try {
      $m = New-Object System.Threading.Mutex($false, 'Global\_MSIExecute')
      if ($m.WaitOne(0)) { $m.ReleaseMutex(); return }
    } catch { return }
    if ($i -eq 0) { Write-Info 'Esperando a que termine otra instalación de Windows...' }
    Start-Sleep -Seconds 10
  }
}

function Find-PuertoLibre([int]$Preferido) {
  for ($p = $Preferido; $p -lt $Preferido + 100; $p++) { if (Test-PuertoLibre $p) { return $p } }
  throw "No hay puertos libres a partir de $Preferido."
}

function Stop-Tabelio {
  try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction Stop } catch { }
  if (Test-Path $AppDir) {
    Get-TabelioNodeProcesses $AppDir | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }
}

function Remove-CarpetaLarga([string]$Path) {
  # node_modules puede tener rutas de más de 260 caracteres; robocopy /MIR con una carpeta vacía las elimina.
  if (-not (Test-Path $Path)) { return }
  $empty = Join-Path $env:TEMP ('vacio-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $empty | Out-Null
  Invoke-Native 'robocopy.exe' @($empty, $Path, '/MIR', '/R:1', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP') -Quiet | Out-Null
  Remove-Item $empty -Force -Recurse -ErrorAction SilentlyContinue
  Remove-Item $Path -Force -Recurse -ErrorAction SilentlyContinue
}

# --------------------------------------------------------------------------------------------
# Detección de componentes
# --------------------------------------------------------------------------------------------
function Find-Node {
  $candidates = @()
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { $candidates += $cmd.Source }
  $candidates += (Join-Path $env:ProgramFiles 'nodejs\node.exe')
  foreach ($c in $candidates) {
    if (Test-Path $c) {
      $version = (& $c --version)
      if ($version -match '^v(\d+)\.' -and [int]$matches[1] -ge 22) { return $c }
    }
  }
  return $null
}

function Find-PgBin {
  # Requiere PostgreSQL 17 o superior: pg_restore no acepta respaldos de una versión más nueva.
  $dirs = @((Join-Path $PgBinDirOwn 'bin'))
  $dirs += Get-ChildItem (Join-Path $env:ProgramFiles 'PostgreSQL') -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^\d+$' -and [int]$_.Name -ge 17 } |
    Sort-Object { [int]$_.Name } -Descending | ForEach-Object { Join-Path $_.FullName 'bin' }
  foreach ($d in $dirs) {
    if ((Test-Path (Join-Path $d 'initdb.exe')) -and (Test-Path (Join-Path $d 'pg_restore.exe'))) {
      $version = (& (Join-Path $d 'initdb.exe') --version)
      if ($version -match '(\d+)\.' -and [int]$matches[1] -ge 17) { return $d }
    }
  }
  return $null
}

function Find-Soffice {
  foreach ($c in @((Join-Path $env:ProgramFiles 'LibreOffice\program\soffice.exe'), (Join-Path ${env:ProgramFiles(x86)} 'LibreOffice\program\soffice.exe'))) {
    if ($c -and (Test-Path $c)) { return $c }
  }
  return $null
}

function Find-Tesseract {
  $cmd = Get-Command tesseract.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($c in @((Join-Path $env:ProgramFiles 'Tesseract-OCR\tesseract.exe'), (Join-Path ${env:ProgramFiles(x86)} 'Tesseract-OCR\tesseract.exe'), (Join-Path $env:LOCALAPPDATA 'Programs\Tesseract-OCR\tesseract.exe'))) {
    if ($c -and (Test-Path $c)) { return $c }
  }
  return $null
}

function Find-PopplerBin {
  $own = Get-ChildItem (Join-Path $ToolsDir 'poppler') -Recurse -Filter pdftotext.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($own) { return $own.DirectoryName }
  $cmd = Get-Command pdftotext.exe -ErrorAction SilentlyContinue
  if ($cmd -and (Test-Path (Join-Path (Split-Path $cmd.Source) 'pdftoppm.exe'))) { return (Split-Path $cmd.Source) }
  return $null
}

function Test-VcRedist {
  $key = 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64'
  if (-not (Test-Path $key)) { $key = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\VisualStudio\14.0\VC\Runtimes\x64' }
  if (-not (Test-Path $key)) { return $false }
  $v = Get-ItemProperty $key
  return ($v.Installed -eq 1 -and [int]$v.Major -ge 14 -and [int]$v.Minor -ge 30)
}

# --------------------------------------------------------------------------------------------
# PostgreSQL
# --------------------------------------------------------------------------------------------
function Get-PgBin {
  $bin = $State.inputs['pgBin']
  if (-not $bin -or -not (Test-Path (Join-Path $bin 'psql.exe'))) { $bin = Find-PgBin }
  if (-not $bin) { throw 'No se encontraron los programas de PostgreSQL.' }
  return $bin
}

function Invoke-Psql([string]$Sql, [string]$Usuario = 'postgres', [string]$BaseDatos = 'postgres', [switch]$Quiet) {
  $password = $Secrets['pgSuperPassword']
  if ($Usuario -ne 'postgres') { $password = $Secrets['dbPassword'] }
  # El SQL va en un archivo: PowerShell 5.1 corrompe las comillas dobles en argumentos de programas externos.
  $file = Join-Path $env:TEMP ('tabelio-' + [guid]::NewGuid().ToString('N') + '.sql')
  [IO.File]::WriteAllText($file, $Sql, (New-Object Text.UTF8Encoding($false)))
  try {
    $r = Invoke-Native (Join-Path (Get-PgBin) 'psql.exe') @('-h', '127.0.0.1', '-p', "$($State.inputs['pgPort'])", '-U', $Usuario, '-d', $BaseDatos,
      '-v', 'ON_ERROR_STOP=1', '-At', '-f', $file) -Environment @{ PGPASSWORD = $password; PGCLIENTENCODING = 'UTF8' } -Quiet:$Quiet
  } finally { Remove-Item $file -Force -ErrorAction SilentlyContinue }
  Assert-Exit $r 'psql falló'
  return $r.Output.Trim()
}

function Wait-Postgres([int]$Segundos = 60) {
  $deadline = (Get-Date).AddSeconds($Segundos)
  while ((Get-Date) -lt $deadline) {
    $r = Invoke-Native (Join-Path (Get-PgBin) 'pg_isready.exe') @('-h', '127.0.0.1', '-p', "$($State.inputs['pgPort'])") -Quiet
    if ($r.ExitCode -eq 0) { return }
    Start-Sleep -Seconds 2
  }
  throw "PostgreSQL no respondió en el puerto $($State.inputs['pgPort'])."
}

function Show-PgLog {
  $log = Get-ChildItem (Join-Path $PgData 'log') -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($log) {
    Write-Info "Últimas líneas de $($log.FullName):"
    Get-Content $log.FullName -Tail 15 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray; Write-Log "      $_" }
  }
}

# --------------------------------------------------------------------------------------------
# IA
# --------------------------------------------------------------------------------------------
function Get-ResponsesUrl([string]$BaseUrl) {
  $u = New-Object UriBuilder($BaseUrl)
  $path = $u.Path.TrimEnd('/')
  if ($path.EndsWith('/v1')) { $u.Path = "$path/responses" } else { $u.Path = "$path/v1/responses" }
  $u.Query = ''; $u.Fragment = ''
  return $u.Uri.AbsoluteUri
}

function Test-ConexionIA([string]$BaseUrl, [string]$Modelo, [string]$Clave) {
  try { $url = Get-ResponsesUrl $BaseUrl } catch { return @{ Ok = $false; Mensaje = 'La URL no es válida.' } }
  if (-not $url.StartsWith('https://')) { return @{ Ok = $false; Mensaje = 'La URL debe usar https://' } }
  $body = @{ model = $Modelo; input = 'Responde solamente: OK'; max_output_tokens = 32 } | ConvertTo-Json
  try {
    $r = Invoke-WebRequest -Uri $url -Method Post -Headers @{ Authorization = "Bearer $Clave" } -ContentType 'application/json' `
      -Body $body -UseBasicParsing -TimeoutSec 90 -UserAgent $UserAgent
    return @{ Ok = $true; Mensaje = "El proveedor respondió correctamente (HTTP $($r.StatusCode))." }
  } catch {
    $status = $null; $detail = $_.Exception.Message
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
      try {
        $reader = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
        $text = $reader.ReadToEnd()
        if ($text) { $detail = $text.Substring(0, [Math]::Min(300, $text.Length)) }
      } catch { }
    }
    $hint = switch ($status) {
      401 { 'La clave fue rechazada (no válida o expirada).' }
      403 { 'La clave no tiene permiso para este modelo o servicio.' }
      404 { 'La URL no es correcta (no existe el servicio /v1/responses).' }
      429 { 'Límite de uso alcanzado; la clave parece válida.' }
      default { 'No se pudo comprobar la conexión.' }
    }
    return @{ Ok = ($status -eq 429); Mensaje = "$hint $detail" }
  }
}

# ============================================================================================
# 1. Requisitos de Windows
# ============================================================================================
Write-Host ''
Write-Host '  Instalador de Tabelio' -ForegroundColor Cyan
Write-Host "  Carpeta de instalación: $Raiz"
Write-Host "  Registro detallado:     $script:LogFile"

Invoke-Step 'requisitos' 'Revisando requisitos de Windows' -SiempreEjecutar -Accion {
  if (-not [Environment]::Is64BitOperatingSystem) { throw 'Tabelio requiere Windows de 64 bits.' }
  if ([Environment]::OSVersion.Version.Build -lt 17763) { throw 'Se requiere Windows 10 versión 1809 o superior.' }
  # TLS 1.2 para descargas en PowerShell 5.1.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  # Rutas largas (node_modules las necesita).
  $fs = 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem'
  if ((Get-ItemProperty $fs -Name LongPathsEnabled -ErrorAction SilentlyContinue).LongPathsEnabled -ne 1) {
    Set-ItemProperty $fs -Name LongPathsEnabled -Value 1 -Type DWord
    Write-Ok 'Rutas largas habilitadas.'
  }
  $online = $false
  foreach ($url in 'https://registry.npmjs.org/', 'https://nodejs.org/', 'https://www.google.com/') {
    try { Invoke-WebRequest -Uri $url -Method Head -UseBasicParsing -TimeoutSec 15 | Out-Null; $online = $true; break } catch { }
  }
  if (-not $online) {
    throw 'No hay conexión a internet (o un proxy/firewall la bloquea). Conecta la PC y vuelve a intentar.'
  }
  Write-Ok 'Windows de 64 bits, permisos de administrador e internet disponibles.'
} | Out-Null

# ============================================================================================
# 2. Datos que se piden al inicio
# ============================================================================================
Write-Titulo 'Datos de configuración'
$in = $State.inputs
$reuse = $false
if ($in['configurado']) {
  Write-Info "Respaldo:   $($in['respaldo'])"
  Write-Info "Documentos: $($in['documentos'])"
  Write-Info "IA:         $($in['iaUrl']) / $($in['iaModelo']) (habilitada: $($in['iaHabilitada']))"
  $reuse = Read-SiNo 'Se encontró una configuración previa. ¿Usarla?' $true
}

if (-not $reuse) {
  # --- Respaldo ---
  $defaultBackup = $RutaRespaldo
  if (-not $defaultBackup) {
    foreach ($c in @((Join-Path (Split-Path $SourceDir -Parent) 'respaldo'), (Join-Path $SourceDir 'respaldo'))) {
      if (Test-Path (Join-Path $c 'database.dump')) { $defaultBackup = $c; break }
    }
  }
  $yaRestaurado = $State.completed.Contains('restaurar-bd')
  if ($yaRestaurado -and -not $defaultBackup) { $defaultBackup = 'CONSERVAR' }
  while ($true) {
    Write-Host ''
    Write-Info 'Respaldo a restaurar (carpeta con database.dump). Escribe DEMO para instalar con datos de demostración.'
    if ($yaRestaurado) { Write-Info 'Esta PC ya tiene datos: escribe CONSERVAR para mantener la base y los documentos actuales.' }
    $backup = Read-Valor 'Carpeta del respaldo' $defaultBackup
    if ($backup -eq 'DEMO') { $in['respaldo'] = 'DEMO'; break }
    if ($backup -eq 'CONSERVAR' -and $yaRestaurado) { break }   # se conservan respaldo/documentos previos
    if ($backup -and (Test-Path (Join-Path $backup 'database.dump'))) {
      $in['respaldo'] = (Resolve-Path $backup).Path
      # Un respaldo nuevo debe verificarse y restaurarse aunque ya se hubiera hecho antes.
      foreach ($s in 'respaldo-verificado', 'restaurar-bd', 'documentos') { $State.completed.Remove($s) }
      break
    }
    if ($backup -and (Test-Path (Join-Path $backup 'database.dump'))) { $in['respaldo'] = (Resolve-Path $backup).Path; break }
    Write-Fallo "No existe database.dump en '$backup'."
  }

  # --- Carpeta de documentos ---
  $needBytes = [int64]0
  $metaPath = Join-Path ([string]$in['respaldo']) 'backup-metadata.json'
  if ($in['respaldo'] -ne 'DEMO' -and (Test-Path $metaPath)) {
    $meta = Get-Content $metaPath -Raw | ConvertFrom-Json
    if ($meta.objectBytes) { $needBytes = [int64]$meta.objectBytes }
  }
  $defaultDocs = Join-Path $Raiz 'documentos'
  $systemDrive = New-Object IO.DriveInfo((Split-Path $Raiz -Qualifier))
  if ($needBytes -gt 0 -and $systemDrive.AvailableFreeSpace -lt ($needBytes * 1.2 + 8GB)) {
    $best = [IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Fixed' -and $_.IsReady } |
      Sort-Object AvailableFreeSpace -Descending | Select-Object -First 1
    if ($best -and $best.Name -ne $systemDrive.Name) { $defaultDocs = Join-Path $best.Name 'TabelioDocumentos' }
  }
  if ($needBytes -gt 0) { Write-Info ("Los documentos del respaldo ocupan {0:N1} GB." -f ($needBytes / 1GB)) }
  $in['documentos'] = [IO.Path]::GetFullPath((Read-Valor 'Carpeta donde se guardarán los documentos' $defaultDocs))

  # --- Pantalla de inicio de sesión ---
  # Sin este correo la pantalla de inicio mostraría las credenciales de demostración.
  if ($in['respaldo'] -eq 'DEMO') {
    $in['loginEmail'] = ''
  } else {
    do {
      $in['loginEmail'] = Read-Valor 'Correo del administrador del despacho (se precarga en el inicio de sesión)' ([string]$in['loginEmail'])
    } while ($in['loginEmail'] -notmatch '^[^@\s]+@[^@\s]+$')
  }

  # --- IA ---
  Write-Host ''
  Write-Info 'Credenciales de Tabelio IA'
  $existingKey = (Read-DotEnv (Join-Path $AppDir '.env'))['ASSISTANT_API_KEY']
  $iaUrl = 'https://api.servicesessentials.ibm.com'; if ($in['iaUrl']) { $iaUrl = $in['iaUrl'] }
  $iaModelo = 'global-models'; if ($in['iaModelo']) { $iaModelo = $in['iaModelo'] }
  $iaUrl = Read-Valor 'URL del proveedor de IA' $iaUrl
  $iaModelo = Read-Valor 'Modelo' $iaModelo
  $clave = ''
  if ($existingKey -and (Read-SiNo 'Ya hay una clave de IA guardada en esta PC. ¿Conservarla?' $true)) { $clave = $existingKey }
  $habilitada = $true
  while ($true) {
    if (-not $clave) {
      $clave = Read-Secreto 'Clave (API key) de IA (Enter para dejar la IA desactivada)'
      if (-not $clave) { $habilitada = $false; Write-Aviso 'La IA quedará desactivada. Puedes volver a ejecutar el instalador para configurarla.'; break }
    }
    Write-Info 'Probando la conexión con el proveedor de IA...'
    $test = Test-ConexionIA $iaUrl $iaModelo $clave
    if ($test.Ok) { Write-Ok $test.Mensaje; break }
    Write-Fallo $test.Mensaje
    Write-Host '    1) Escribir otra clave   2) Cambiar URL/modelo   3) Guardar así y continuar   4) Dejar la IA desactivada'
    $opt = Read-Valor 'Opción' '1'
    switch ($opt) {
      '2' { $iaUrl = Read-Valor 'URL del proveedor de IA' $iaUrl; $iaModelo = Read-Valor 'Modelo' $iaModelo }
      '3' { break }
      '4' { $habilitada = $false; $clave = ''; break }
      default { $clave = '' }
    }
    if ($opt -eq '3' -or $opt -eq '4') { break }
  }
  $in['iaUrl'] = $iaUrl
  $in['iaModelo'] = $iaModelo
  $in['iaHabilitada'] = $habilitada
  $script:ClaveIA = $clave
  $in['configurado'] = $true
  Save-State
} else {
  $script:ClaveIA = (Read-DotEnv (Join-Path $AppDir '.env'))['ASSISTANT_API_KEY']
}

# Puertos: se eligen una sola vez y se conservan entre ejecuciones.
if (-not $in['pgPort']) { $in['pgPort'] = Find-PuertoLibre 55432 }
if (-not $in['apiPort']) { $in['apiPort'] = Find-PuertoLibre 4000 }
if (-not $in['webPort']) {
  $web = Find-PuertoLibre 3000
  if ($web -eq $in['apiPort']) { $web = Find-PuertoLibre ($web + 1) }
  $in['webPort'] = $web
}
Save-State
Write-Ok "Puertos: web $($in['webPort']), API $($in['apiPort']), PostgreSQL $($in['pgPort'])."
Write-Info 'A partir de aquí la instalación no requiere intervención salvo que algo falle.'

# ============================================================================================
# 3. Verificación del respaldo y espacio en disco
# ============================================================================================
Invoke-Step 'respaldo-verificado' 'Verificando el respaldo' -Accion {
  if ($in['respaldo'] -eq 'DEMO') { Write-Info 'Instalación con datos de demostración.'; return }
  $manifest = Join-Path $in['respaldo'] 'manifest.sha256'
  if (Test-Path $manifest) {
    foreach ($line in Get-Content $manifest) {
      if ($line -match '^([0-9a-fA-F]{64})\s+\*?(.+)$') {
        $file = Join-Path $in['respaldo'] $matches[2].Trim()
        if (-not (Test-Path $file)) { throw "Falta $($matches[2]) en el respaldo." }
        Write-Info "Comprobando $($matches[2])..."
        if ((Get-FileHash -Algorithm SHA256 $file).Hash -ne $matches[1].ToUpper()) {
          throw "El archivo $($matches[2]) está dañado (hash distinto). Copia de nuevo el respaldo."
        }
      }
    }
    Write-Ok 'Integridad del respaldo verificada.'
  } else {
    Write-Aviso 'El respaldo no tiene manifest.sha256; no se puede verificar su integridad.'
  }
} | Out-Null

Invoke-Step 'espacio' 'Revisando espacio en disco' -SiempreEjecutar -Accion {
  $needSystem = 6GB
  $docsBytes = [int64]0
  if ($in['respaldo'] -ne 'DEMO' -and -not $State.completed.Contains('documentos') -and (Test-Path (Join-Path $in['respaldo'] 'database.dump'))) {
    $needSystem += (Get-Item (Join-Path $in['respaldo'] 'database.dump')).Length * 4
    $meta = Join-Path $in['respaldo'] 'backup-metadata.json'
    if (Test-Path $meta) { $docsBytes = [int64]((Get-Content $meta -Raw | ConvertFrom-Json).objectBytes) }
  }
  $sys = New-Object IO.DriveInfo((Split-Path $Raiz -Qualifier))
  $docs = New-Object IO.DriveInfo((Split-Path $in['documentos'] -Qualifier))
  if ($sys.Name -eq $docs.Name) { $needSystem += $docsBytes; $docsBytes = 0 }
  # Lo ya copiado en una ejecución anterior no cuenta como faltante.
  $already = 0
  if (Test-Path $in['documentos']) { $already = (Get-ChildItem $in['documentos'] -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum }
  if ($sys.Name -eq $docs.Name) { $needSystem -= $already } else { $docsBytes -= $already }
  if ($sys.AvailableFreeSpace -lt $needSystem) {
    throw ("Espacio insuficiente en {0}: se necesitan {1:N1} GB y hay {2:N1} GB libres. Libera espacio o elige otra carpeta de documentos (ejecuta con -ReiniciarEstado)." -f $sys.Name, ($needSystem / 1GB), ($sys.AvailableFreeSpace / 1GB))
  }
  if ($docsBytes -gt 0 -and $docs.AvailableFreeSpace -lt ($docsBytes * 1.05)) {
    throw ("Espacio insuficiente en {0} para los documentos: se necesitan {1:N1} GB." -f $docs.Name, ($docsBytes / 1GB))
  }
  Write-Ok 'Espacio suficiente.'
} | Out-Null

# ============================================================================================
# 4. Dependencias del sistema
# ============================================================================================
Invoke-Step 'vcredist' 'Microsoft Visual C++ (requerido por PostgreSQL)' -Accion {
  if (Test-VcRedist) { Write-Ok 'Ya instalado.'; return }
  Wait-MsiLibre
  try {
    $exe = Get-Descarga 'https://aka.ms/vs/17/release/vc_redist.x64.exe' 'vc_redist.x64.exe'
    $r = Invoke-Native $exe @('/install', '/quiet', '/norestart') -Quiet
    Write-Log "vc_redist código $($r.ExitCode)"
  } catch { Write-Aviso $_.Exception.Message }
  if (-not (Test-VcRedist)) { Install-ConWinget 'Microsoft.VCRedist.2015+.x64' }
  if (-not (Test-VcRedist)) { throw 'No se pudo instalar Visual C++ Redistributable.' }
  Write-Ok 'Instalado.'
} | Out-Null

Invoke-Step 'node' 'Node.js (22 o superior)' -Accion {
  $node = Find-Node
  if (-not $node) {
    Wait-MsiLibre
    Install-ConWinget 'OpenJS.NodeJS.LTS'
    $node = Find-Node
  }
  if (-not $node) {
    Write-Info 'Descargando Node.js directamente de nodejs.org...'
    $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing -TimeoutSec 60
    $release = $index | Where-Object { $_.lts -and $_.files -contains 'win-x64-msi' -and [int]($_.version.TrimStart('v').Split('.')[0]) -ge 22 } | Select-Object -First 1
    if (-not $release) { throw 'No se encontró una versión LTS de Node.js para descargar.' }
    $msi = Get-Descarga "https://nodejs.org/dist/$($release.version)/node-$($release.version)-x64.msi" "node-$($release.version)-x64.msi"
    Wait-MsiLibre
    Install-Msi $msi
    $node = Find-Node
  }
  if (-not $node) { throw 'Node.js no quedó disponible después de instalarlo.' }
  $in['nodeExe'] = $node
  Save-State
  Write-Ok "Node.js $(& $node --version) en $node"
} -Reparar { Update-SessionPath } | Out-Null
$env:Path = (Split-Path $in['nodeExe']) + ';' + $env:Path
$npm = Join-Path (Split-Path $in['nodeExe']) 'npm.cmd'

Invoke-Step 'postgres-binarios' 'PostgreSQL 17 (programas)' -Accion {
  $bin = Find-PgBin
  if (-not $bin) {
    Write-Info 'Descargando los binarios oficiales de PostgreSQL (EnterpriseDB)...'
    $minors = @()
    try {
      $versions = Invoke-RestMethod -Uri 'https://www.postgresql.org/versions.json' -UseBasicParsing -TimeoutSec 60
      $latest = ($versions | Where-Object { [string]$_.major -eq '17' }).latestMinor
      if ($null -ne $latest) { $minors += [int]$latest }
    } catch { Write-Aviso 'No se pudo consultar la última versión; se probarán versiones conocidas.' }
    $minors += 15..0
    $zip = $null
    foreach ($m in ($minors | Select-Object -Unique)) {
      try { $zip = Get-Descarga "https://get.enterprisedb.com/postgresql/postgresql-17.$m-1-windows-x64-binaries.zip" "postgresql-17.$m.zip"; break } catch { }
    }
    if ($zip) {
      $extract = Join-Path (Split-Path $zip) 'extraido'
      Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force
      $pgsql = Join-Path $extract 'pgsql'
      if (-not (Test-Path (Join-Path $pgsql 'bin\initdb.exe'))) { throw 'El ZIP de PostgreSQL no tiene la estructura esperada.' }
      if (Test-Path $PgBinDirOwn) { Remove-Item $PgBinDirOwn -Recurse -Force }
      Move-Item $pgsql $PgBinDirOwn
      Remove-Item (Join-Path $PgBinDirOwn 'pgAdmin 4') -Recurse -Force -ErrorAction SilentlyContinue
      $bin = Find-PgBin
    }
  }
  if (-not $bin) {
    Write-Info 'Probando el instalador de PostgreSQL con winget...'
    Wait-MsiLibre
    Install-ConWinget 'PostgreSQL.PostgreSQL.17' @('--override', "--mode unattended --unattendedmodeui none --superpassword $($Secrets['pgSuperPassword']) --disable-components stackbuilder,pgAdmin")
    $bin = Find-PgBin
  }
  if (-not $bin) { throw 'No se pudo obtener PostgreSQL 17.' }
  & icacls.exe (Split-Path $bin) /grant "${SidNetworkService}:(OI)(CI)RX" /T /Q | Out-Null
  $in['pgBin'] = $bin
  Save-State
  Write-Ok "PostgreSQL en $bin"
} | Out-Null

Invoke-Step 'postgres-servicio' 'PostgreSQL (base de datos y servicio de Windows)' -Accion {
  $bin = Get-PgBin
  if (-not (Test-Path (Join-Path $PgData 'PG_VERSION'))) {
    if (Test-Path $PgData) { Remove-Item $PgData -Recurse -Force }   # restos de un intento fallido
    New-Item -ItemType Directory -Force -Path $PgData | Out-Null
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $PgData /grant "*${me}:(OI)(CI)F" "${SidNetworkService}:(OI)(CI)F" | Out-Null
    # initdb corre con un token restringido (sin el grupo Administradores): el archivo va en TEMP del usuario.
    $pwFile = Join-Path $env:TEMP ('tabelio-pw-' + [guid]::NewGuid().ToString('N') + '.tmp')
    [IO.File]::WriteAllText($pwFile, $Secrets['pgSuperPassword'], (New-Object Text.UTF8Encoding($false)))
    try {
      $common = @('-D', $PgData, '-U', 'postgres', "--pwfile=$pwFile", '-E', 'UTF8', '-A', 'scram-sha-256')
      $r = Invoke-Native (Join-Path $bin 'initdb.exe') ($common + @('--locale-provider=icu', '--icu-locale=es-MX'))
      if ($r.ExitCode -ne 0) {
        Write-Aviso 'initdb con ICU falló; reintentando con la configuración regional predeterminada.'
        Remove-Item $PgData -Recurse -Force; New-Item -ItemType Directory -Force -Path $PgData | Out-Null
        & icacls.exe $PgData /grant "*${me}:(OI)(CI)F" "${SidNetworkService}:(OI)(CI)F" | Out-Null
        $r = Invoke-Native (Join-Path $bin 'initdb.exe') $common
      }
      Assert-Exit $r 'initdb falló'
    } finally { Remove-Item $pwFile -Force -ErrorAction SilentlyContinue }
    Add-Content -Path (Join-Path $PgData 'postgresql.conf') -Encoding ASCII -Value @(
      '', '# --- Tabelio ---', "port = $($in['pgPort'])", "listen_addresses = 'localhost'",
      "logging_collector = on", "log_directory = 'log'", "log_rotation_size = 20MB")
    & icacls.exe $PgData /grant "${SidNetworkService}:(OI)(CI)F" /T /Q | Out-Null
  }
  if (-not (Get-Service -Name $PgServiceName -ErrorAction SilentlyContinue)) {
    $r = Invoke-Native (Join-Path $bin 'pg_ctl.exe') @('register', '-N', $PgServiceName, '-D', $PgData, '-S', 'auto', '-U', 'NT AUTHORITY\NetworkService')
    Assert-Exit $r 'No se pudo registrar el servicio de PostgreSQL'
    & sc.exe failure $PgServiceName reset= 86400 actions= restart/10000/restart/30000/restart/60000 | Out-Null
  }
  $svc = Get-Service -Name $PgServiceName
  if ($svc.Status -ne 'Running') { Start-Service -Name $PgServiceName }
  Wait-Postgres 90
  $pw = $Secrets['dbPassword']
  if ((Invoke-Psql "SELECT 1 FROM pg_roles WHERE rolname='despacho'" -Quiet) -eq '1') {
    Invoke-Psql "ALTER ROLE despacho WITH LOGIN PASSWORD '$pw'" -Quiet | Out-Null
  } else {
    Invoke-Psql "CREATE ROLE despacho WITH LOGIN PASSWORD '$pw'" -Quiet | Out-Null
  }
  if ((Invoke-Psql "SELECT 1 FROM pg_database WHERE datname='despacho'" -Quiet) -ne '1') {
    Invoke-Psql 'CREATE DATABASE despacho OWNER despacho' -Quiet | Out-Null
  }
  Write-Ok "Servicio $PgServiceName activo en el puerto $($in['pgPort'])."
} -Reparar {
  Show-PgLog
  $pidFile = Join-Path $PgData 'postmaster.pid'
  if ((Test-Path $pidFile) -and -not (Get-Process postgres -ErrorAction SilentlyContinue)) {
    Write-Info 'Eliminando postmaster.pid obsoleto.'
    Remove-Item $pidFile -Force
  }
  if (Test-Path $PgData) { & icacls.exe $PgData /grant "${SidNetworkService}:(OI)(CI)F" /T /Q | Out-Null }
  $svc = Get-Service -Name $PgServiceName -ErrorAction SilentlyContinue
  if ($svc -and $svc.Status -ne 'Running' -and -not (Test-PuertoLibre $in['pgPort'])) {
    $newPort = Find-PuertoLibre ([int]$in['pgPort'] + 1)
    Write-Info "El puerto $($in['pgPort']) está ocupado por otro programa; se cambia a $newPort."
    $in['pgPort'] = $newPort; Save-State
    Add-Content -Path (Join-Path $PgData 'postgresql.conf') -Encoding ASCII -Value "port = $newPort"
  }
} | Out-Null

Invoke-Step 'libreoffice' 'LibreOffice (generación de PDF)' -Opcional -Intentos 2 -Accion {
  $soffice = Find-Soffice
  if (-not $soffice) {
    Wait-MsiLibre
    Install-ConWinget 'TheDocumentFoundation.LibreOffice'
    $soffice = Find-Soffice
  }
  if (-not $soffice) {
    $listing = (Invoke-WebRequest -Uri 'https://download.documentfoundation.org/libreoffice/stable/' -UseBasicParsing -TimeoutSec 60).Content
    $version = [regex]::Matches($listing, 'href="(\d+\.\d+\.\d+)/"') | ForEach-Object { $_.Groups[1].Value } |
      Sort-Object { [version]$_ } -Descending | Select-Object -First 1
    if (-not $version) { throw 'No se pudo determinar la versión estable de LibreOffice.' }
    $msi = Get-Descarga "https://download.documentfoundation.org/libreoffice/stable/$version/win/x86_64/LibreOffice_${version}_Win_x86-64.msi" "LibreOffice_$version.msi"
    Wait-MsiLibre
    Install-Msi $msi
    $soffice = Find-Soffice
  }
  if (-not $soffice) { throw 'LibreOffice no quedó instalado.' }
  $in['soffice'] = $soffice; Save-State
  Write-Ok "LibreOffice en $soffice"
} | Out-Null

Invoke-Step 'tesseract' 'Tesseract OCR con español (lectura de documentos escaneados)' -Opcional -Intentos 2 -Accion {
  $tess = Find-Tesseract
  if (-not $tess) {
    Install-ConWinget 'UB-Mannheim.TesseractOCR'
    $tess = Find-Tesseract
  }
  if (-not $tess) {
    $asset = Get-GitHubAsset 'UB-Mannheim/tesseract' 'w64-setup.*\.exe$'
    $exe = Get-Descarga $asset.browser_download_url $asset.name
    Invoke-Native $exe @('/S') -Quiet | Out-Null
    Start-Sleep -Seconds 5
    $tess = Find-Tesseract
  }
  if (-not $tess) { throw 'Tesseract no quedó instalado.' }
  $tessdata = Join-Path (Split-Path $tess) 'tessdata'
  foreach ($lang in 'spa', 'eng') {
    $target = Join-Path $tessdata "$lang.traineddata"
    if (-not (Test-Path $target)) {
      Write-Info "Agregando idioma $lang a Tesseract..."
      $file = Get-Descarga "https://github.com/tesseract-ocr/tessdata/raw/main/$lang.traineddata" "$lang.traineddata"
      Copy-Item $file $target -Force
    }
  }
  $langs = (Invoke-Native $tess @('--list-langs') -Quiet).Output
  if ($langs -notmatch '(?m)^spa\s*$') { throw 'Tesseract no reconoce el idioma español.' }
  $in['tesseract'] = $tess; Save-State
  Write-Ok "Tesseract en $tess (español e inglés)."
} | Out-Null

Invoke-Step 'poppler' 'Poppler (lectura de PDF)' -Opcional -Intentos 2 -Accion {
  $bin = Find-PopplerBin
  if (-not $bin) {
    try {
      $asset = Get-GitHubAsset 'oschwartz10612/poppler-windows' '\.zip$'
      $zip = Get-Descarga $asset.browser_download_url $asset.name
      $target = Join-Path $ToolsDir 'poppler'
      if (Test-Path $target) { Remove-Item $target -Recurse -Force }
      Expand-Archive -LiteralPath $zip -DestinationPath $target -Force
    } catch { Write-Aviso "Descarga directa de Poppler falló: $($_.Exception.Message)" }
    $bin = Find-PopplerBin
  }
  if (-not $bin) {
    Install-ConWinget 'oschwartz10612.Poppler'
    $bin = Find-PopplerBin
  }
  if (-not $bin) { throw 'Poppler no quedó instalado.' }
  foreach ($exe in 'pdfinfo.exe', 'pdftotext.exe', 'pdftoppm.exe') {
    if (-not (Test-Path (Join-Path $bin $exe))) { throw "Falta $exe en $bin" }
  }
  $in['poppler'] = $bin; Save-State
  Write-Ok "Poppler en $bin"
} | Out-Null

# ============================================================================================
# 5. Aplicación
# ============================================================================================
Invoke-Step 'codigo' 'Copiando Tabelio a la carpeta de instalación' -SiempreEjecutar -Accion {
  Stop-Tabelio
  if ([IO.Path]::GetFullPath($SourceDir).TrimEnd('\') -ieq [IO.Path]::GetFullPath($AppDir).TrimEnd('\')) {
    Write-Ok 'El instalador se ejecuta desde la carpeta instalada; no se copia.'
    return
  }
  # /MIR actualiza y elimina archivos viejos; las carpetas/archivos excluidos (dependencias, builds, .env) se conservan.
  $r = Invoke-Native 'robocopy.exe' (@($SourceDir, $AppDir, '/MIR', '/R:3', '/W:3', '/NP', '/NFL', '/NDL', '/NJH',
    '/XD', 'node_modules', '.git', '.next', 'dist', '.import-work', 'backups', 'storage', 'tmp', '.certificates', 'respaldo',
    '/XF', '.env', '.env.*', '*.log', '*.tsbuildinfo'))
  if ($r.ExitCode -ge 8) { throw "robocopy falló con código $($r.ExitCode)." }
  Write-Ok "Código copiado en $AppDir"
} | Out-Null

function Write-EnvFile {
  $assistantEnabled = 'false'
  if ($in['iaHabilitada'] -and $script:ClaveIA) { $assistantEnabled = 'true' }
  $ocrEnabled = 'false'
  if ($in['tesseract'] -and $in['poppler'] -and (Test-Path $in['tesseract'])) { $ocrEnabled = 'true' }
  $web = $in['webPort']; $api = $in['apiPort']
  $f = { param($p) ($p -replace '\\', '/') }
  $lines = @(
    '# Generado por scripts/windows/instalar-tabelio.ps1. Vuelve a ejecutar el instalador para cambiarlo.',
    'NODE_ENV=production',
    "DATABASE_URL=postgresql://despacho:$($Secrets['dbPassword'])@127.0.0.1:$($in['pgPort'])/despacho?schema=public",
    "JWT_SECRET=$($Secrets['jwtSecret'])",
    "API_PORT=$api",
    "WEB_ORIGIN=http://localhost:$web,http://127.0.0.1:$web",
    'COOKIE_SECURE=false',
    'STORAGE_DRIVER=local',
    "LOCAL_STORAGE_PATH=$(& $f $in['documentos'])",
    "TEMPLATE_ROOT=$(& $f (Join-Path $AppDir 'apps\api\templates'))",
    "MCP_OUTPUT_DIR=$(& $f (Join-Path $Raiz 'datos\mcp-downloads'))",
    "PDF_CONVERSION_TIMEOUT_MS=120000"
  )
  if ($in['soffice']) { $lines += "LIBREOFFICE_BIN=$(& $f $in['soffice'])" }
  $lines += "LOCAL_OCR_ENABLED=$ocrEnabled"
  if ($ocrEnabled -eq 'true') {
    $lines += @(
      'LOCAL_OCR_LANGUAGE=spa+eng',
      "LOCAL_OCR_TESSERACT_BIN=$(& $f $in['tesseract'])",
      "LOCAL_OCR_PDFINFO_BIN=$(& $f (Join-Path $in['poppler'] 'pdfinfo.exe'))",
      "LOCAL_OCR_PDFTOTEXT_BIN=$(& $f (Join-Path $in['poppler'] 'pdftotext.exe'))",
      "LOCAL_OCR_PDFTOPPM_BIN=$(& $f (Join-Path $in['poppler'] 'pdftoppm.exe'))"
    )
  }
  $lines += @(
    '',
    "NEXT_PUBLIC_LOGIN_EMAIL=$($in['loginEmail'])",
    'NEXT_PUBLIC_LOGIN_PASSWORD=',
    '',
    '# --- Tabelio IA ---',
    "ASSISTANT_ENABLED=$assistantEnabled",
    "ASSISTANT_API_BASE_URL=$($in['iaUrl'])",
    'ASSISTANT_RESPONSES_PATH=',
    "ASSISTANT_API_KEY=$($script:ClaveIA)",
    'ASSISTANT_API_KEY_HEADER=Authorization',
    'ASSISTANT_API_KEY_SCHEME=Bearer',
    "ASSISTANT_MODEL=$($in['iaModelo'])",
    "ASSISTANT_MCP_URL=http://127.0.0.1:$api/mcp",
    'ASSISTANT_MCP_TIMEOUT_MS=15000',
    'ASSISTANT_TURN_TIMEOUT_MS=90000',
    'ASSISTANT_TIMEOUT_MS=45000',
    'ASSISTANT_MAX_OUTPUT_TOKENS=6000',
    'ASSISTANT_MAX_TOOL_ROUNDS=6',
    'ASSISTANT_MAX_TOOL_CALLS_PER_RESPONSE=8',
    'ASSISTANT_MAX_TOOL_CALLS_PER_TURN=16',
    'ASSISTANT_MAX_PENDING_ACTIONS_PER_USER=3',
    'ASSISTANT_RATE_LIMIT_PER_MINUTE=12',
    'DOCUMENT_EXTRACTION_ENABLED=false'
  )
  $envPath = Join-Path $AppDir '.env'
  [IO.File]::WriteAllLines($envPath, [string[]]$lines, (New-Object Text.UTF8Encoding($false)))
  # Contiene secretos: sólo administradores y SYSTEM (la tarea de arranque corre como SYSTEM).
  & icacls.exe $envPath /inheritance:r /grant:r "${SidAdmins}:F" "${SidSystem}:F" | Out-Null
  foreach ($d in $in['documentos'], (Join-Path $Raiz 'datos\mcp-downloads')) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
  }
}

function Get-AppEnv([hashtable]$Extra = @{}) {
  $values = @{}
  $dotenv = Read-DotEnv (Join-Path $AppDir '.env')
  foreach ($k in $dotenv.Keys) { $values[$k] = $dotenv[$k] }
  foreach ($k in $Extra.Keys) { $values[$k] = $Extra[$k] }
  return $values
}

Invoke-Step 'env' 'Generando configuración (.env)' -SiempreEjecutar -Accion {
  Write-EnvFile
  Write-Ok 'Archivo .env generado con secretos aleatorios.'
} | Out-Null

$lockHash = (Get-FileHash -Algorithm SHA256 (Join-Path $AppDir 'package-lock.json')).Hash.Substring(0, 16)
if (-not (Test-Path (Join-Path $AppDir 'node_modules\.package-lock.json'))) { $State.completed.Remove("npm-$lockHash"); Save-State }
Invoke-Step "npm-$lockHash" 'Instalando dependencias de la aplicación (npm ci, puede tardar varios minutos)' -Intentos 4 -Accion {
  $r = Invoke-Native $npm @('ci', '--no-audit', '--no-fund', '--loglevel=error') -WorkingDirectory $AppDir `
    -Environment @{ npm_config_update_notifier = 'false'; npm_config_fetch_retries = '5'; npm_config_fetch_retry_maxtimeout = '120000'; NODE_ENV = 'development' }
  Assert-Exit $r 'npm ci falló'
  Write-Ok 'Dependencias instaladas.'
} -Reparar {
  param($intento)
  Stop-Tabelio
  Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path -like "$AppDir*" } | Stop-Process -Force -ErrorAction SilentlyContinue
  if ($intento -ge 1) { Invoke-Native $npm @('cache', 'verify') -Quiet | Out-Null }
  if ($intento -ge 2) {
    Write-Info 'Limpiando caché de npm y node_modules...'
    Invoke-Native $npm @('cache', 'clean', '--force') -Quiet | Out-Null
    Remove-CarpetaLarga (Join-Path $AppDir 'node_modules')
    Invoke-Native $npm @('config', 'set', 'registry', 'https://registry.npmjs.org/') -Quiet | Out-Null
  }
} | Out-Null

# ============================================================================================
# 6. Base de datos y documentos
# ============================================================================================
Invoke-Step 'restaurar-bd' 'Restaurando la base de datos del respaldo' -Accion {
  if ($in['respaldo'] -eq 'DEMO') { Write-Info 'Sin respaldo: se cargarán datos de demostración.'; return }
  Stop-Tabelio
  Wait-Postgres 60
  $hasData = Invoke-Psql "SELECT CASE WHEN to_regclass('public.""Organization""') IS NULL THEN 0 ELSE 1 END" -Usuario despacho -BaseDatos despacho -Quiet
  if ($hasData -eq '1') {
    $count = Invoke-Psql 'SELECT count(*) FROM "Organization"' -Usuario despacho -BaseDatos despacho -Quiet
    if ([int]$count -gt 0) {
      if (-not (Read-SiNo "La base de datos ya tiene $count organización(es). ¿Reemplazarla con el respaldo? (se perderán los cambios hechos en esta PC)" $false)) {
        Write-Info 'Se conserva la base de datos actual.'
        return
      }
    }
  }
  Write-Info 'Preparando una base de datos limpia...'
  Invoke-Psql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='despacho' AND pid <> pg_backend_pid()" -Quiet | Out-Null
  Invoke-Psql 'DROP DATABASE IF EXISTS despacho' -Quiet | Out-Null
  Invoke-Psql 'CREATE DATABASE despacho OWNER despacho' -Quiet | Out-Null

  Write-Info 'Restaurando (puede tardar varios minutos)...'
  $r = Invoke-Native (Join-Path (Get-PgBin) 'pg_restore.exe') @('-h', '127.0.0.1', '-p', "$($in['pgPort'])", '-U', 'despacho', '-d', 'despacho',
    '--no-owner', '--no-privileges', '--jobs', '4', (Join-Path $in['respaldo'] 'database.dump')) -Environment @{ PGPASSWORD = $Secrets['dbPassword']; LC_MESSAGES = 'C' } -Quiet
  $errors = $r.Output -split "`n" | Where-Object { $_ -match 'error:' -and $_ -notmatch 'already exists|ya existe|must be owner|debe ser dueño|errors ignored|errores ignorados' }
  if ($errors) {
    $errors | Select-Object -First 10 | ForEach-Object { Write-Fallo $_ }
    throw 'pg_restore reportó errores.'
  }
  $orgs = Invoke-Psql 'SELECT count(*) FROM "Organization"' -Usuario despacho -BaseDatos despacho -Quiet
  $users = Invoke-Psql 'SELECT count(*) FROM "User"' -Usuario despacho -BaseDatos despacho -Quiet
  if ([int]$orgs -lt 1) { throw 'La restauración terminó pero no hay organizaciones en la base.' }
  Write-Ok "Base restaurada: $orgs organización(es), $users usuario(s)."
} -Reparar { Show-PgLog; Start-Service -Name $PgServiceName -ErrorAction SilentlyContinue } | Out-Null

Invoke-Step 'documentos' 'Restaurando los documentos' -Intentos 3 -Accion {
  if ($in['respaldo'] -eq 'DEMO') { return }
  $docsSource = Join-Path $in['respaldo'] 'documentos'
  $tarGz = Join-Path $in['respaldo'] 'object-storage.tar.gz'
  $tar = Join-Path $in['respaldo'] 'object-storage.tar'
  if (Test-Path $docsSource) {
    Write-Info "Copiando documentos a $($in['documentos']) (puede tardar bastante)..."
    $r = Invoke-Native 'robocopy.exe' @($docsSource, $in['documentos'], '/E', '/R:3', '/W:5', '/MT:16', '/NP', '/NFL', '/NDL')
    if ($r.ExitCode -ge 8) { throw "robocopy falló con código $($r.ExitCode)." }
  } elseif ((Test-Path $tarGz) -or (Test-Path $tar)) {
    $archive = $tarGz; if (-not (Test-Path $archive)) { $archive = $tar }
    Write-Info 'Extrayendo documentos...'
    $r = Invoke-Native (Join-Path $env:SystemRoot 'System32\tar.exe') @('-xf', $archive, '-C', $in['documentos'])
    Assert-Exit $r 'No se pudo extraer el archivo de documentos'
  } else {
    Write-Aviso 'El respaldo no incluye documentos (sólo base de datos).'
    return
  }
  $meta = Join-Path $in['respaldo'] 'backup-metadata.json'
  $copied = @(Get-ChildItem $in['documentos'] -Recurse -File -ErrorAction SilentlyContinue).Count
  if (Test-Path $meta) {
    $expected = [int]((Get-Content $meta -Raw | ConvertFrom-Json).objectCount)
    if ($copied -lt $expected) { throw "Se copiaron $copied de $expected documentos." }
  }
  Write-Ok "$copied documentos disponibles."
} | Out-Null

Invoke-Step 'migraciones' 'Aplicando migraciones de base de datos' -SiempreEjecutar -Accion {
  Stop-Tabelio   # prisma generate no puede reemplazar el motor si la API lo tiene abierto
  Wait-Postgres 60
  $envs = Get-AppEnv @{ NODE_ENV = 'production' }
  $r = Invoke-Native $npm @('run', 'db:generate') -WorkingDirectory $AppDir -Environment $envs -Mask @($Secrets['dbPassword'])
  Assert-Exit $r 'prisma generate falló'
  $r = Invoke-Native $npm @('run', 'db:deploy') -WorkingDirectory $AppDir -Environment $envs -Mask @($Secrets['dbPassword'])
  Assert-Exit $r 'prisma migrate deploy falló'
  if ($in['respaldo'] -eq 'DEMO' -and -not $State.completed.Contains('seed')) {
    $r = Invoke-Native $npm @('run', 'db:seed') -WorkingDirectory $AppDir -Environment $envs -Mask @($Secrets['dbPassword'])
    Assert-Exit $r 'No se pudieron cargar los datos de demostración'
    Complete-Step 'seed'
  }
  if ($in['loginEmail']) {
    $email = ([string]$in['loginEmail']).Replace("'", "''")
    $found = Invoke-Psql "SELECT count(*) FROM ""User"" WHERE lower(email) = lower('$email')" -Usuario despacho -BaseDatos despacho -Quiet
    if ([int]$found -lt 1) { Write-Aviso "El correo $($in['loginEmail']) no existe en la base restaurada; revisa que sea el correcto." }
  }
  Write-Ok 'Base de datos al día.'
} -Reparar { Start-Service -Name $PgServiceName -ErrorAction SilentlyContinue } | Out-Null

# ============================================================================================
# 7. Compilación
# ============================================================================================
Invoke-Step 'compilar' 'Compilando Tabelio (versión de producción)' -SiempreEjecutar -Accion {
  Stop-Tabelio
  $envs = Get-AppEnv @{
    NODE_ENV = 'production'
    NEXT_TELEMETRY_DISABLED = '1'
    API_PROXY_TARGET = "http://127.0.0.1:$($in['apiPort'])/api"
  }
  $r = Invoke-Native $npm @('run', 'build') -WorkingDirectory $AppDir -Environment $envs -Mask @($Secrets['dbPassword'], $script:ClaveIA)
  Assert-Exit $r 'La compilación falló'

  $standalone = Join-Path $AppDir 'apps\web\.next\standalone'
  $server = Get-ChildItem $standalone -Recurse -Filter server.js -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch '\\node_modules\\' } | Sort-Object { $_.FullName.Length } | Select-Object -First 1
  if (-not $server) { throw 'No se generó el servidor web (server.js).' }
  $webDir = $server.DirectoryName
  $static = Join-Path $webDir '.next\static'
  if (Test-Path $static) { Remove-Item $static -Recurse -Force }
  Copy-Item (Join-Path $AppDir 'apps\web\.next\static') $static -Recurse -Force
  $public = Join-Path $AppDir 'apps\web\public'
  $publicTarget = Join-Path $webDir 'public'
  if (Test-Path $publicTarget) { Remove-Item $publicTarget -Recurse -Force }
  if (Test-Path $public) { Copy-Item $public $publicTarget -Recurse -Force }
  # El build "standalone" de Next copia archivos .env; se eliminan porque la configuración llega por variables.
  Get-ChildItem $standalone -Recurse -Filter '.env*' -File -Force -ErrorAction SilentlyContinue | Remove-Item -Force
  $in['webServer'] = $server.FullName; Save-State
  if (-not (Test-Path (Join-Path $AppDir 'apps\api\dist\main.js'))) { throw 'No se generó la API (apps\api\dist\main.js).' }
  Write-Ok 'Compilación terminada.'
} -Reparar {
  Write-Info 'Limpiando compilaciones previas...'
  foreach ($d in 'apps\web\.next', 'apps\api\dist', 'packages\domain\dist', 'packages\database\dist') {
    Remove-CarpetaLarga (Join-Path $AppDir $d)
  }
} | Out-Null

# ============================================================================================
# 8. Arranque automático, accesos directos y verificación
# ============================================================================================
Invoke-Step 'arranque' 'Configurando el arranque automático y accesos directos' -SiempreEjecutar -Accion {
  $config = [ordered]@{
    appDir = $AppDir; nodeExe = $in['nodeExe']; webServer = $in['webServer']; logsDir = $LogsDir
    pgService = $PgServiceName; pgPort = [int]$in['pgPort']; apiPort = [int]$in['apiPort']; webPort = [int]$in['webPort']
  }
  Write-JsonFile (Join-Path $ConfigDir 'instalacion.json') $config

  $script = Join-Path $AppDir 'scripts\windows\iniciar-tabelio.ps1'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`" -RaizInstalacion `"$Raiz`""
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
    -Description 'Inicia Tabelio (API y web) y lo mantiene funcionando.' -Force | Out-Null

  $url = "http://localhost:$($in['webPort'])"
  $icon = Join-Path $AppDir 'apps\web\app\favicon.ico'
  $urlFile = @('[InternetShortcut]', "URL=$url")
  if (Test-Path $icon) { $urlFile += @("IconFile=$icon", 'IconIndex=0') }
  $publicDesktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
  $startMenu = Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'Tabelio'
  New-Item -ItemType Directory -Force -Path $startMenu | Out-Null
  Set-Content -Path (Join-Path $publicDesktop 'Tabelio.url') -Value $urlFile -Encoding ASCII
  Set-Content -Path (Join-Path $startMenu 'Abrir Tabelio.url') -Value $urlFile -Encoding ASCII

  $shell = New-Object -ComObject WScript.Shell
  $restart = $shell.CreateShortcut((Join-Path $startMenu 'Reiniciar Tabelio.lnk'))
  $restart.TargetPath = 'powershell.exe'
  $restart.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $AppDir 'scripts\windows\detener-tabelio.ps1')`" -RaizInstalacion `"$Raiz`" -Reiniciar"
  $restart.Description = 'Reinicia Tabelio (requiere administrador)'
  $restart.Save()
  # Marca "Ejecutar como administrador" en el acceso directo.
  $lnk = Join-Path $startMenu 'Reiniciar Tabelio.lnk'
  $bytes = [IO.File]::ReadAllBytes($lnk); $bytes[0x15] = $bytes[0x15] -bor 0x20; [IO.File]::WriteAllBytes($lnk, $bytes)
  $logs = $shell.CreateShortcut((Join-Path $startMenu 'Registros de Tabelio.lnk'))
  $logs.TargetPath = $LogsDir
  $logs.Save()
  Write-Ok 'Tarea programada "Tabelio" y accesos directos creados.'
} | Out-Null

Invoke-Step 'verificar' 'Iniciando Tabelio y verificando que responda' -SiempreEjecutar -Accion {
  Stop-Tabelio
  Start-ScheduledTask -TaskName $TaskName
  Write-Info 'Esperando a la API...'
  if (-not (Wait-Url "http://127.0.0.1:$($in['apiPort'])/api/health/ready" 180)) {
    foreach ($f in 'api-errores.log', 'api.log', 'vigilante.log') {
      $p = Join-Path $LogsDir $f
      if (Test-Path $p) { Write-Info "Últimas líneas de ${f}:"; Get-Content $p -Tail 15 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray; Write-Log "      $_" } }
    }
    throw 'La API no respondió.'
  }
  Write-Ok 'API lista.'
  Write-Info 'Esperando a la web...'
  if (-not (Wait-Url "http://127.0.0.1:$($in['webPort'])/login" 180)) {
    $p = Join-Path $LogsDir 'web-errores.log'
    if (Test-Path $p) { Get-Content $p -Tail 15 | ForEach-Object { Write-Host "      $_" -ForegroundColor DarkGray; Write-Log "      $_" } }
    throw 'La web no respondió.'
  }
  Write-Ok 'Web lista.'
} -Reparar { Start-Service -Name $PgServiceName -ErrorAction SilentlyContinue } | Out-Null

# Limpieza de instaladores descargados.
Remove-Item $DownloadsDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Titulo 'Tabelio quedó instalado'
Write-Info "Dirección:          http://localhost:$($in['webPort'])  (acceso directo 'Tabelio' en el escritorio)"
Write-Info "Aplicación:         $AppDir"
Write-Info "Documentos:         $($in['documentos'])"
Write-Info "Base de datos:      servicio $PgServiceName, puerto $($in['pgPort']) (contraseñas en $SecretsPath)"
Write-Info "Registros:          $LogsDir"
Write-Info 'Arranque:           automático al encender la PC (tarea programada "Tabelio")'
if ($in['iaHabilitada'] -and $script:ClaveIA) { Write-Ok 'Tabelio IA habilitada.' } else { Write-Aviso 'Tabelio IA desactivada: vuelve a ejecutar el instalador para capturar la clave.' }
if (-not $in['soffice']) { Write-Aviso 'Sin LibreOffice: no se podrán generar PDF.' }
if (-not ($in['tesseract'] -and $in['poppler'])) { Write-Aviso 'Sin Tesseract/Poppler: la lectura local de documentos escaneados está desactivada.' }
foreach ($o in $script:Omitidos) { Write-Aviso "Omitido: $o" }
Start-Process "http://localhost:$($in['webPort'])"
