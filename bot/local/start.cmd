@echo off
rem Storm Central X bot: double-click to start (see README.md in this folder).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
pause
