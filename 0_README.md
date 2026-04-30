# AI競馬予測アプリ - 使い方ガイド

## 🚀 起動方法（1クリック起動）

| お使いのOS | ダブルクリックするファイル |
|----|----|
| **Windows** | `1_START_Windows.bat` |
| **Mac** | `1_START_Mac.command` |
| **Linux** | `1_START_Linux.sh`（端末から実行） |

> ⚠️ **Macで「開発元未確認」と出た場合**
> ファイルを **右クリック** → **「開く」** → **「開く」** で許可してください
> （初回のみ。次からは普通にダブルクリックで起動できます）

---

## 📋 初回起動時にやること

起動スクリプトが以下を自動でやってくれます:

1. ✅ Node.js / Python の確認
2. ✅ 必要なパッケージの自動インストール（初回のみ・数分）
3. ✅ サーバー起動
4. ✅ **ブラウザを自動で開く** → `http://localhost:3004/race-id-viewer.html`

---

## ⚙️ 必要なソフト（事前にインストール）

起動前に以下が必要です:

### 1. Node.js（v18以上）

- 公式: https://nodejs.org/ja/
- **「LTS版（推奨版）」** を選んでください
- macOS の人は `brew install node` でもOK

### 2. Python（3.8以上）

- 公式: https://www.python.org/downloads/
- **Windows の人は要注意**: インストール時に **「Add Python to PATH」** に必ずチェック
- macOS / Linux はたいてい標準で入っています

---

## 🛑 停止方法

サーバーが動いているターミナル/コマンドプロンプトのウィンドウで **Ctrl+C** を押してください。

---

## 📊 アプリの使い方

1. ブラウザが自動で開きます（または `http://localhost:3004/race-id-viewer.html` にアクセス）
2. **レースID** を入力（例: `202509020611`）または **今週のレース一覧** から選択
3. **「予測実行」** ボタンを押す
4. AI予測結果（スコア、推奨買い目、勝負レース判定）が表示されます

### レースIDの調べ方

netkeiba.com の出馬表ページのURLから取得:

```
https://race.netkeiba.com/race/shutuba.html?race_id=202509020611
                                                    ↑ この12桁がレースID
```

---

## 🐎 中央競馬・地方競馬どちらも対応

| 競馬場 | レースIDの先頭 |
|--------|---------------|
| **中央(JRA)** | 札幌 01 / 函館 02 / 福島 03 / 新潟 04 / 東京 05 / 中山 06 / 中京 07 / 京都 08 / 阪神 09 / 小倉 10 |
| **地方(NAR)** | 門別 30 / 大井 34 / 川崎 35 / 名古屋 38 / 園田 39 / 高知 41 / 佐賀 42 ほか |

---

## 🆘 困ったときは

### 「Node.js がインストールされていません」と出る
→ Node.js を https://nodejs.org/ja/ からインストール（LTS版を選択）

### 「Python がインストールされていません」と出る
→ Python を https://www.python.org/downloads/ からインストール
→ Windowsではインストール時に **「Add Python to PATH」** に必ずチェック

### npm install でエラーが出る
→ ターミナル/コマンドプロンプトで以下を実行:
```bash
cd <このフォルダのパス>
npm install
```

### Python ライブラリがインストールできない
→ ターミナル/コマンドプロンプトで以下を実行:
```bash
# Mac/Linux:
python3 -m pip install -r requirements.txt

# Windows:
python -m pip install -r requirements.txt
```

### 「ポート3004が使えない」と出る
→ 既に別のサーバーが動いている可能性があります
→ そのサーバーを停止するか、別のポートで起動:
```bash
# Mac/Linux:
PORT=3005 node race-id-prediction-app.js

# Windows:
set PORT=3005 && node race-id-prediction-app.js
```

### 予測結果が出ない / オッズが取れない
→ レースIDが正しいか、出馬表が確定済みか確認してください
→ レース直前（前日19時以降）が最も精度が高くなります

---

## 📈 予測モデルの精度（実測値）

CSVバックテスト（2015-2025、49.4万件、35,531レース）で検証済み:

| 項目 | 数値 |
|------|------|
| AI 1着的中率 | **33.04%** |
| AI 3着内的中率 | **64.84%** |
| 全レース機械的に top1 単勝買い | 回収率 **155.6%** |
| EV>=1.25 で買い | 回収率 **210.1%** |
| EV>=1.5 で買い | 回収率 **228.4%** |
| EV>=2.0 score>=40 で超厳選 | 回収率 **277.0%** |

> ※ 過去データでの実測値です。**未来の収益を保証するものではありません**

---

## 📁 ファイル構成

```
keiba_app/
├── 0_README.md                 ← このファイル（最初に読む）
├── 1_START_Windows.bat         ← Windowsの人はこれをダブルクリック
├── 1_START_Mac.command         ← Macの人はこれをダブルクリック
├── 1_START_Linux.sh            ← Linuxの人はこれを実行
├── package.json                (Node依存定義)
├── requirements.txt            (Python依存定義)
├── race-id-prediction-app.js   (サーバー本体)
├── race-id-viewer.html         (UI画面)
├── predict_v2.py               (AI予測スクリプト)
├── model_v2.pkl                (学習済みモデル: 49.4万件)
├── course_master.json          (コース物理特徴データ)
├── race-statistics.json        (騎手・調教師統計)
└── src/
    ├── model/                  (AI予測モジュール)
    └── scraper/                (netkeiba取得モジュール)
```
