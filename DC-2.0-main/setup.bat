@echo off
echo ========================================
echo DC Dashboard - Quick Setup Script
echo ========================================
echo.

REM Check if Bun is installed
where bun >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Bun is not installed!
    echo.
    echo Please install Bun first:
    echo   Visit: https://bun.sh
    echo   Or run: powershell -c "irm bun.sh/install.ps1 | iex"
    echo.
    pause
    exit /b 1
)

echo [1/4] Bun is installed ✓
echo.

echo [2/4] Installing dependencies...
call bun install
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies
    pause
    exit /b 1
)
echo Dependencies installed ✓
echo.

echo [3/4] Creating data directory...
if not exist "data" mkdir data
if not exist "public\uploads" mkdir public\uploads
echo Directories created ✓
echo.

echo [4/4] Setup complete!
echo.
echo ========================================
echo IMPORTANT: Configure your FRS servers
echo ========================================
echo.
echo 1. Edit config\config.json
echo 2. Update server URLs and API tokens
echo 3. Run: bun run dev
echo 4. Open: http://localhost:3000
echo.
echo ========================================
echo.

echo Would you like to start the application now? (Y/N)
set /p START_NOW=
if /i "%START_NOW%"=="Y" (
    echo.
    echo Starting DC Dashboard...
    echo Press Ctrl+C to stop the server
    echo.
    call bun run dev
)

pause
