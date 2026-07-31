@echo off
setlocal
set "APP_DIR=%~dp0"
set "PYTHON_DIR=%APP_DIR%..\python-3.12.8-embed-amd64"
set "PYTHON=%PYTHON_DIR%\python.exe"

cd /d "%APP_DIR%"

if not exist "%PYTHON%" (
  echo Portable Python was not found.
  echo Expected: "%PYTHON%"
  echo.
  echo Please copy this app together with the sibling folder:
  echo "%PYTHON_DIR%"
  echo.
  pause
  exit /b 1
)

set "PYTHONUTF8=1"
"%PYTHON%" -m streamlit run "%APP_DIR%app.py"
echo.
if errorlevel 1 (
  echo Failed to start. Please check README.md for setup instructions.
) else (
  echo App stopped.
)
echo.
pause
