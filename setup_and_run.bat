@echo off
setlocal
set "APP_DIR=%~dp0"
cd /d "%APP_DIR%"

where python >nul 2>nul
if errorlevel 1 (
  echo Python が見つかりません。
  echo https://www.python.org/downloads/ から Python 3.12 をインストールしてから、
  echo このファイルをもう一度実行してください。
  echo インストール時は「Add python.exe to PATH」にチェックを入れてください。
  echo.
  pause
  exit /b 1
)

if not exist "%APP_DIR%.venv\Scripts\python.exe" (
  echo 初回セットアップを行います。少々お待ちください...
  python -m venv .venv
  if errorlevel 1 (
    echo 仮想環境の作成に失敗しました。
    pause
    exit /b 1
  )
  ".venv\Scripts\python.exe" -m pip install --upgrade pip
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 (
    echo ライブラリのインストールに失敗しました。
    pause
    exit /b 1
  )
  echo セットアップが完了しました。
  echo.
)

set "PYTHONUTF8=1"
".venv\Scripts\python.exe" -m streamlit run "%APP_DIR%app.py"
echo.
if errorlevel 1 (
  echo 起動に失敗しました。README.md を確認してください。
) else (
  echo アプリを終了しました。
)
echo.
pause
