@echo off
echo ========================================
echo Creating Deployment Package
echo ========================================
echo.

set PACKAGE_NAME=DC_Dashboard_Package_%date:~-4,4%%date:~-10,2%%date:~-7,2%
set EXCLUDE_DIRS=node_modules .next out data public\uploads *.db *.db-shm *.db-wal .git

echo Creating package: %PACKAGE_NAME%.zip
echo.

REM Check if 7zip or tar is available
where tar >nul 2>nul
if %errorlevel% equ 0 (
    echo Using tar to create archive...
    tar -czf %PACKAGE_NAME%.tar.gz ^
        --exclude=node_modules ^
        --exclude=.next ^
        --exclude=out ^
        --exclude=data ^
        --exclude=public/uploads ^
        --exclude=*.db ^
        --exclude=*.db-shm ^
        --exclude=*.db-wal ^
        --exclude=.git ^
        .
    echo.
    echo ✓ Package created: %PACKAGE_NAME%.tar.gz
) else (
    echo [WARNING] tar not found. Creating zip manually...
    powershell -Command "Compress-Archive -Path .\* -DestinationPath %PACKAGE_NAME%.zip -Force -CompressionLevel Optimal"
    echo.
    echo ✓ Package created: %PACKAGE_NAME%.zip
)

echo.
echo ========================================
echo Package Contents:
echo ========================================
echo - Source code (all TypeScript/TSX files)
echo - Configuration files
echo - Installation scripts (setup.bat, setup.sh)
echo - Documentation (README.md, INSTALLATION.md)
echo - Package.json (dependencies list)
echo.
echo EXCLUDED (will be regenerated on target server):
echo - node_modules (dependencies)
echo - .next (build files)
echo - data (database)
echo - public/uploads (images)
echo.
echo ========================================
echo Deployment Instructions:
echo ========================================
echo 1. Transfer %PACKAGE_NAME% to target server
echo 2. Extract the archive
echo 3. Run setup.bat (Windows) or setup.sh (Linux/Mac)
echo 4. Edit config/config.json with your FRS servers
echo 5. Start with: bun run dev
echo.
echo ========================================

pause
