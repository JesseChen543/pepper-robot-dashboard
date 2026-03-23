@echo off
REM Virtual Environment Setup Script for Pepper Project (Windows)
REM This creates an isolated Python environment for PC-side development

echo ========================================
echo Pepper Project - Virtual Environment Setup
echo ========================================
echo.

REM Check Python version
python --version
echo.

REM Create virtual environment
echo [1/4] Creating virtual environment 'venv_pepper'...
python -m venv venv_pepper
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to create virtual environment
    echo Make sure Python 3.6+ is installed
    pause
    exit /b 1
)
echo Done!
echo.

REM Activate virtual environment
echo [2/4] Activating virtual environment...
call venv_pepper\Scripts\activate.bat
echo Done!
echo.

REM Upgrade pip
echo [3/4] Upgrading pip...
python -m pip install --upgrade pip
echo Done!
echo.

REM Install requirements
echo [4/4] Installing dependencies from requirements-pc.txt...
pip install -r requirements-pc.txt
echo Done!
echo.

echo ========================================
echo Setup Complete!
echo ========================================
echo.
echo To activate the virtual environment in the future, run:
echo   venv_pepper\Scripts\activate.bat
echo.
echo To deactivate, run:
echo   deactivate
echo.
pause
