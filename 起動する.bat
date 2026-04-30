@echo off
echo.
echo AI競馬予測アプリ を起動しています...
echo.

node --version > nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js がインストールされていません
    echo https://nodejs.org/ja/ からインストールしてください
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo node_modules がないので npm install を実行します...
    npm install
    echo.
)

echo Pythonの必要ライブラリをチェック中...
python -c "import numpy" > nul 2>&1
if %errorlevel% neq 0 (
    echo numpyをインストール中...
    python -m pip install numpy --quiet
)
python -c "import sklearn" > nul 2>&1
if %errorlevel% neq 0 (
    echo scikit-learnをインストール中...
    python -m pip install scikit-learn --quiet
)

echo.
echo サーバーを起動します
echo.
echo ブラウザで以下を開いてください：
echo http://localhost:3004/race-id-viewer.html
echo.
echo このウィンドウは閉じないでください
echo.
node race-id-prediction-app.js
pause
