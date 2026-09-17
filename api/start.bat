@echo off
SETLOCAL

SET "API_DIR=%~dp0"
SET "VENV_DIR=%API_DIR%.venv"

echo ============================================
echo  Tintoreria de Hilos - API Local
echo ============================================

:: Crear entorno virtual si no existe
IF NOT EXIST "%VENV_DIR%\Scripts\python.exe" (
    echo Creando entorno virtual...
    python -m venv "%VENV_DIR%"
    IF ERRORLEVEL 1 (
        echo ERROR: No se pudo crear el entorno virtual.
        echo Verifica que Python 3.11+ este instalado.
        pause
        exit /b 1
    )
)

:: Instalar dependencias
echo Instalando/verificando dependencias...
"%VENV_DIR%\Scripts\pip" install -q -r "%API_DIR%requirements.txt"
IF ERRORLEVEL 1 (
    echo ERROR: Fallo la instalacion de dependencias.
    pause
    exit /b 1
)

:: Iniciar servidor
echo.
echo Servidor iniciando en http://127.0.0.1:8000
echo Documentacion: http://127.0.0.1:8000/docs
echo.
"%VENV_DIR%\Scripts\python" "%API_DIR%main.py"

pause
