@echo off
echo Setting up AAKSO Order Manager (Tauri)
echo.

REM Check Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Node.js is not installed. Please install Node.js v16+ from https://nodejs.org/
    exit /b 1
)

echo Node.js found: 
node --version

REM Check Rust
where rustc >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Rust is not installed. Please install Rust from https://www.rust-lang.org/tools/install
    echo Or run: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs ^| sh
    exit /b 1
)

echo Rust found:
rustc --version

echo.
echo Installing npm dependencies...
call npm install

if %ERRORLEVEL% NEQ 0 (
    echo Failed to install npm dependencies
    exit /b 1
)

echo.
echo Setup complete!
echo.
echo To run the app in development mode:
echo   npm run tauri dev
echo.
echo To build the executable:
echo   npm run tauri build
echo.
pause
