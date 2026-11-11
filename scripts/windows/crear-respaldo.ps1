# Crea un respaldo de Tabelio local (Windows, sin Docker) que el instalador puede restaurar.
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\crear-respaldo.ps1 -Destino E:\Entrega\respaldo
# Resultado:
#   database.dump          pg_dump formato custom (--no-owner --no-privileges)
#   documentos\            copia de LOCAL_STORAGE_PATH (carpeta, para no exceder 4 GB por archivo en USB FAT32)
#   backup-metadata.json   número y tamaño de documentos, para verificar la restauración
#   manifest.sha256        hash de database.dump y backup-metadata.json
param(
  [Parameter(Mandatory)] [string]$Destino,
  [string]$ArchivoEnv,
  [switch]$SoloBaseDeDatos
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\comun.ps1')
Update-SessionPath

$projectDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $ArchivoEnv) { $ArchivoEnv = Join-Path $projectDir '.env' }
$envValues = Read-DotEnv $ArchivoEnv
if (-not $envValues['DATABASE_URL']) { throw "DATABASE_URL no está definido en $ArchivoEnv" }

$uri = [Uri]($envValues['DATABASE_URL'] -replace '^postgres(ql)?://', 'http://')
$userInfo = $uri.UserInfo.Split(':', 2)
$dbUser = [Uri]::UnescapeDataString($userInfo[0])
$dbPassword = if ($userInfo.Count -gt 1) { [Uri]::UnescapeDataString($userInfo[1]) } else { '' }
$dbName = $uri.AbsolutePath.TrimStart('/')
$dbPort = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }

$pgDump = (Get-Command pg_dump.exe -ErrorAction SilentlyContinue).Source
if (-not $pgDump) {
  $pgDump = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\pg_dump.exe', 'C:\Tabelio\postgresql\bin\pg_dump.exe' -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.Directory.Parent.Name -replace '\D', '0') } -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $pgDump) { throw 'No se encontró pg_dump.exe. Instala PostgreSQL o agrega su carpeta bin al PATH.' }

if (Test-Path (Join-Path $Destino 'database.dump')) { throw "Ya existe un respaldo en $Destino. Usa una carpeta vacía." }
New-Item -ItemType Directory -Force -Path $Destino | Out-Null
Set-TabelioLog (Join-Path $Destino 'respaldo.log')

Write-Titulo 'Respaldando base de datos'
$result = Invoke-Native $pgDump @('--host', $uri.Host, '--port', "$dbPort", '--username', $dbUser, '--dbname', $dbName,
  '--format', 'custom', '--no-owner', '--no-privileges', '--file', (Join-Path $Destino 'database.dump')) -Environment @{ PGPASSWORD = $dbPassword }
if ($result.ExitCode -ne 0) { throw 'pg_dump falló; revisa que PostgreSQL esté encendido.' }
Write-Ok 'database.dump creado.'

$objectCount = 0; $objectBytes = 0
if (-not $SoloBaseDeDatos -and ($envValues['STORAGE_DRIVER'] -eq $null -or $envValues['STORAGE_DRIVER'] -eq 'local')) {
  $storage = $envValues['LOCAL_STORAGE_PATH']
  if (-not $storage) { $storage = Join-Path $projectDir 'storage' }
  if (-not [IO.Path]::IsPathRooted($storage)) { $storage = Join-Path $projectDir $storage }
  if (-not (Test-Path $storage)) { throw "No existe el directorio de documentos: $storage" }
  Write-Titulo "Copiando documentos desde $storage"
  $docs = Join-Path $Destino 'documentos'
  $copy = Invoke-Native 'robocopy.exe' @($storage, $docs, '/E', '/R:3', '/W:5', '/MT:8', '/NP', '/NFL', '/NDL', '/XD', '_health')
  if ($copy.ExitCode -ge 8) { throw "robocopy falló con código $($copy.ExitCode)." }
  $files = Get-ChildItem -LiteralPath $docs -Recurse -File -Force
  $objectCount = @($files).Count
  $objectBytes = ($files | Measure-Object -Property Length -Sum).Sum
  if ($null -eq $objectBytes) { $objectBytes = 0 }
  Write-Ok ("{0} documentos copiados ({1:N1} GB)." -f $objectCount, ($objectBytes / 1GB))
}

$metadata = [ordered]@{
  formatVersion = 2
  createdAt = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
  database = $dbName
  storageDriver = 'local'
  storageLayout = 'directory'
  objectCount = $objectCount
  objectBytes = [int64]$objectBytes
  databaseOnly = [bool]$SoloBaseDeDatos
}
[IO.File]::WriteAllText((Join-Path $Destino 'backup-metadata.json'), ($metadata | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))

$manifest = foreach ($name in 'database.dump', 'backup-metadata.json') {
  '{0}  {1}' -f (Get-FileHash -Algorithm SHA256 (Join-Path $Destino $name)).Hash.ToLower(), $name
}
[IO.File]::WriteAllLines((Join-Path $Destino 'manifest.sha256'), [string[]]$manifest, (New-Object Text.UTF8Encoding($false)))
Write-Ok "Respaldo listo en $Destino"
