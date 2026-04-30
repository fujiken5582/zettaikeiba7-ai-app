@echo off
title AI競馬予測アプリ
echo.
echo ============================================
echo   AI競馬予測アプリ を起動しています...
echo ============================================
echo.

REM === Node.js チェック ===
node --version > nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js がインストールされていません
    echo.
    echo  以下のサイトからインストールしてください:
    echo  https://nodejs.org/ja/
    echo.
    echo  ※ "LTS版" の "推奨版" を選んでください
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do set NODE_VER=%%v
echo [OK] Node.js %NODE_VER%

REM === Python コマンド検出 (python3 / python / py) ===
set PYTHON_CMD=
python3 --version > nul 2>&1
if %errorlevel% equ 0 (
    set PYTHON_CMD=python3
) else (
    python --version > nul 2>&1
    if %errorlevel% equ 0 (
        set PYTHON_CMD=python
    ) else (
        py --version > nul 2>&1
        if %errorlevel% equ 0 set PYTHON_CMD=py
    )
)

if "%PYTHON_CMD%"=="" (
    echo [ERROR] Python がインストールされていません
    echo.
    echo  以下のサイトからインストールしてください:
    echo  https://www.python.org/downloads/
    echo.
    echo  ※ インストール時に "Add Python to PATH" にチェックを入れてください
    echo.
    pause
    exit /b 1
)
echo [OK] Python: %PYTHON_CMD%

REM === Node 依存パッケージのインストール ===
if not exist "node_modules" (
    echo.
    echo [初回セットアップ] Nodeパッケージをインストール中... (数分かかります)
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo [ERROR] npm install に失敗しました
        echo  手動で 'npm install' を実行してみてください
        pause
        exit /b 1
    )
)

REM === Python 依存パッケージのチェック ===
echo.
echo [チェック] Python ライブラリ...
%PYTHON_CMD% -c "import numpy, sklearn" > nul 2>&1
if %errorlevel% neq 0 (
    echo [初回セットアップ] Python ライブラリをインストール中...
    %PYTHON_CMD% -m pip install -r requirements.txt --user
    if %errorlevel% neq 0 (
        %PYTHON_CMD% -m pip install -r requirements.txt --break-system-packages
    )
    %PYTHON_CMD% -c "import numpy, sklearn" > nul 2>&1
    if %errorlevel% neq 0 (
        echo [ERROR] Python ライブラリのインストールに失敗
        echo  手動で実行: %PYTHON_CMD% -m pip install -r requirements.txt
        pause
        exit /b 1
    )
)
echo [OK] Python 依存パッケージ確認済み

REM === 環境変数 ===
set PORT=3004

echo.
echo ============================================
echo   サーバー起動中...
echo ============================================
echo.
echo  起動完了後、自動でブラウザが開きます
echo  このウィンドウは「閉じないで」ください
echo.
echo  停止する時は Ctrl+C を押してください
echo.

REM === 5秒後にブラウザを自動で開く（バックグラウンド）===
start /b cmd /c "timeout /t 5 /nobreak > nul && start http://localhost:%PORT%/race-id-viewer.html"

REM === サーバー起動（フォアグラウンド・ログ表示）===
node race-id-prediction-app.js

echo.
echo サーバーが停止しました
pause
