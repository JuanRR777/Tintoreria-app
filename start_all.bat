@echo off
setlocal EnableExtensions
title Tintoreria de Hilos
cd /d "%~dp0"

echo ================================================
echo   Tintoreria de Hilos - Sistema de Produccion
echo ================================================
echo.

if not exist "ui\node_modules\electron\dist\electron.exe" (
    echo ERROR: Falta Electron. Ejecuta: cd ui ^&^& npm install
    pause
    exit /b 1
)
if not exist "api\.venv\Scripts\python.exe" (
    echo ERROR: Falta Python del proyecto. Ejecuta api\start.bat
    pause
    exit /b 1
)
if not exist "api\.env" (
    echo ERROR: Falta api\.env
    pause
    exit /b 1
)

echo Comprobando API en http://127.0.0.1:8000 ...
curl.exe -s -m 2 http://127.0.0.1:8000/health 2>nul | findstr /C:"ok" >nul
if %errorlevel%==0 (
    echo API ya esta en marcha.
    goto launch_ui
)

echo Arrancando API Python (ventana aparte)...
start "API Tintoreria" /D "%~dp0api" cmd /k ".venv\Scripts\python.exe -u main.py"

set WAIT=0
:wait_api
timeout /t 1 /nobreak >nul
curl.exe -s -m 2 http://127.0.0.1:8000/health 2>nul | findstr /C:"ok" >nul
if %errorlevel%==0 goto launch_ui
set /a WAIT+=1
echo Esperando API... %WAIT%/90
if %WAIT% GEQ 90 (
    echo.
    echo ERROR: La API no respondio. Mira la ventana "API Tintoreria".
    pause
    exit /b 1
)
goto wait_api

:launch_ui
echo.
echo Abriendo interfaz Electron...
cd /d "%~dp0ui"
set ELECTRON_ENABLE_LOGGING=1
"node_modules\electron\dist\electron.exe" .
echo.
echo Electron se cerro con codigo %ERRORLEVEL%
pause
