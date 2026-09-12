@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   Starting CloudSearch ...
echo.
node server.js
echo.
echo   Server stopped. Press any key to exit.
pause >nul
