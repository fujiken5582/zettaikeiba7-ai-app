#!/bin/bash
# AI競馬予測アプリ - Linux用起動スクリプト
# 端末から ./起動する.sh で実行、もしくはダブルクリック→「実行」

cd "$(dirname "$0")"

clear
echo ""
echo "============================================"
echo "  AI競馬予測アプリ を起動しています..."
echo "============================================"
echo ""

if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js がインストールされていません"
    echo "  Ubuntu/Debian: sudo apt install nodejs npm"
    echo "  または公式: https://nodejs.org/ja/"
    read -p "Press Enter to exit..."
    exit 1
fi
echo "[OK] Node.js $(node --version)"

PYTHON_CMD=""
if command -v python3 &> /dev/null; then PYTHON_CMD=python3
elif command -v python &> /dev/null; then PYTHON_CMD=python
fi
if [ -z "$PYTHON_CMD" ]; then
    echo "[ERROR] Python がインストールされていません"
    echo "  Ubuntu/Debian: sudo apt install python3 python3-pip"
    read -p "Press Enter to exit..."
    exit 1
fi
echo "[OK] $($PYTHON_CMD --version)"

if [ ! -d "node_modules" ]; then
    echo ""
    echo "[初回セットアップ] Nodeパッケージをインストール中..."
    npm install || { echo "[ERROR] npm install 失敗"; read; exit 1; }
fi

echo ""
echo "[チェック] Python ライブラリ..."
if ! $PYTHON_CMD -c "import numpy, sklearn" &> /dev/null; then
    echo "[初回セットアップ] Python ライブラリをインストール中..."
    $PYTHON_CMD -m pip install -r requirements.txt --user 2>/dev/null \
      || $PYTHON_CMD -m pip install -r requirements.txt --break-system-packages 2>/dev/null \
      || $PYTHON_CMD -m pip install -r requirements.txt
fi
echo "[OK] Python 依存パッケージ確認済み"

export PYTHON_CMD=$PYTHON_CMD
export PORT=3004

echo ""
echo "============================================"
echo "  サーバー起動中..."
echo "============================================"
echo "  起動完了後、自動でブラウザが開きます"
echo "  停止: Ctrl+C"
echo ""

# Linuxでブラウザを開くコマンド
OPEN_CMD=""
if command -v xdg-open &> /dev/null; then OPEN_CMD=xdg-open
elif command -v gnome-open &> /dev/null; then OPEN_CMD=gnome-open
fi

if [ -n "$OPEN_CMD" ]; then
    (sleep 5 && $OPEN_CMD "http://localhost:$PORT/race-id-viewer.html") &
else
    echo "  ブラウザで以下を開いてください:"
    echo "  http://localhost:$PORT/race-id-viewer.html"
fi

node race-id-prediction-app.js

echo ""
read -p "サーバーが停止しました。Press Enter to exit..."
