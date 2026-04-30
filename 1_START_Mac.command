#!/bin/bash
# AI競馬予測アプリ - Mac用起動スクリプト
# このファイルをダブルクリックすると起動します

# スクリプトのあるディレクトリに移動
cd "$(dirname "$0")"

clear
echo ""
echo "============================================"
echo "  AI競馬予測アプリ を起動しています..."
echo "============================================"
echo ""

# === Node.js チェック ===
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js がインストールされていません"
    echo ""
    echo "  以下のサイトからインストールしてください:"
    echo "  https://nodejs.org/ja/"
    echo ""
    echo "  ※ \"LTS版\" の \"推奨版\" を選んでください"
    echo ""
    echo "  または Homebrew がある場合: brew install node"
    echo ""
    read -p "Press Enter to exit..."
    exit 1
fi
echo "[OK] Node.js $(node --version)"

# === Python コマンド検出 ===
PYTHON_CMD=""
if command -v python3 &> /dev/null; then
    PYTHON_CMD=python3
elif command -v python &> /dev/null; then
    PYTHON_CMD=python
fi

if [ -z "$PYTHON_CMD" ]; then
    echo "[ERROR] Python がインストールされていません"
    echo ""
    echo "  以下のサイトからインストールしてください:"
    echo "  https://www.python.org/downloads/"
    echo ""
    echo "  または Homebrew がある場合: brew install python3"
    echo ""
    read -p "Press Enter to exit..."
    exit 1
fi
echo "[OK] $($PYTHON_CMD --version)"

# === Node 依存パッケージのインストール ===
if [ ! -d "node_modules" ]; then
    echo ""
    echo "[初回セットアップ] Nodeパッケージをインストール中... (数分かかります)"
    npm install
    if [ $? -ne 0 ]; then
        echo ""
        echo "[ERROR] npm install に失敗しました"
        read -p "Press Enter to exit..."
        exit 1
    fi
fi

# === Python 依存パッケージのチェック・インストール ===
echo ""
echo "[チェック] Python ライブラリ..."
if ! $PYTHON_CMD -c "import numpy, sklearn" &> /dev/null; then
    echo "[初回セットアップ] Python ライブラリをインストール中..."
    # まず通常のインストールを試みる
    $PYTHON_CMD -m pip install -r requirements.txt --user 2>/dev/null \
      || $PYTHON_CMD -m pip install -r requirements.txt --break-system-packages 2>/dev/null \
      || $PYTHON_CMD -m pip install -r requirements.txt
    if ! $PYTHON_CMD -c "import numpy, sklearn" &> /dev/null; then
        echo "[ERROR] Python ライブラリのインストールに失敗しました"
        echo "  手動で以下を実行してください:"
        echo "  $PYTHON_CMD -m pip install -r requirements.txt"
        read -p "Press Enter to exit..."
        exit 1
    fi
fi
echo "[OK] Python 依存パッケージ確認済み"

# === 環境変数 ===
export PYTHON_CMD=$PYTHON_CMD
export PORT=3004

echo ""
echo "============================================"
echo "  サーバー起動中..."
echo "============================================"
echo ""
echo "  起動完了後、自動でブラウザが開きます"
echo "  このウィンドウは「閉じないで」ください"
echo ""
echo "  停止する時は Ctrl+C を押してください"
echo ""

# === 5秒後にブラウザを自動で開く（バックグラウンド）===
(sleep 5 && open "http://localhost:$PORT/race-id-viewer.html") &

# === サーバー起動（フォアグラウンド・ログ表示）===
node race-id-prediction-app.js

echo ""
echo "サーバーが停止しました"
read -p "Press Enter to exit..."
