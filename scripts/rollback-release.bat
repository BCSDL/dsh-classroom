@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0rollback-release.ps1"
pause
