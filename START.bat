@echo off
setlocal

cd /d "%~dp0"

echo Starting Deployable Knowledge setup...
echo (This may open Windows security prompts for installing Node.js/Ollama - that's expected.)
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"

if errorlevel 1 (
	echo.
	echo Something went wrong - see the messages above.
	pause
	exit /b 1
)

pause
