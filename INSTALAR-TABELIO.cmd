@echo off
rem Instalador de Tabelio para Windows. Doble clic para ejecutar (pide permisos de administrador).
setlocal
cd /d "%~dp0"

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Solicitando permisos de administrador...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

set "SCRIPT=%~dp0tabelio\scripts\windows\instalar-tabelio.ps1"
if not exist "%SCRIPT%" set "SCRIPT=%~dp0scripts\windows\instalar-tabelio.ps1"
if not exist "%SCRIPT%" (
  echo No se encontro instalar-tabelio.ps1 junto a este archivo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
echo.
pause
