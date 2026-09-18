@echo off
cd /d "%~dp0"
title Tintoreria - Deploy release
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\deploy-release.ps1"
if errorlevel 1 (
  echo.
  echo Deploy fallo. Revisa el log arriba.
  pause
)
exit /b %ERRORLEVEL%
