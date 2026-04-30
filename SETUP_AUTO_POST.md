# 自動投稿システム セットアップ手順

## 1. Discord Webhook を Secrets に登録

1. GitHubリポジトリを開く
2. **Settings** タブ → 左メニュー「**Secrets and variables**」→「**Actions**」
3. 緑の「**New repository secret**」ボタン
4. **Name**: `DISCORD_WEBHOOK`
5. **Secret**: あなたのWebhook URLを貼り付け
   ```
   https://discord.com/api/webhooks/1499257988324528260/...
   ```
6. 「Add secret」

## 2. GitHub Pages を有効化

1. GitHubリポジトリの **Settings** タブ
2. 左メニュー「**Pages**」
3. **Source**: 「Deploy from a branch」
4. **Branch**: `main` / Folder: `/docs`
5. **Save**
6. 数分で `https://(あなたのユーザー名).github.io/zettai-atarukun/` が公開

## 3. Workflow の権限を確認

1. **Settings** → 左メニュー「**Actions**」→「**General**」
2. ページ下部「**Workflow permissions**」
3. 「**Read and write permissions**」を選択
4. 「Save」

## 4. 動作テスト（手動実行）

1. **Actions** タブ
2. 左メニュー「**Weekly Race Prediction Post**」
3. 右上「**Run workflow**」→「**Run workflow**」（緑ボタン）
4. 数分後、実行結果を確認
5. Discordに通知が来れば成功！

## 自動実行スケジュール

毎週**土曜と日曜の朝9:30 JST**に自動で実行されます。
