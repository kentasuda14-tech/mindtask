# MindTask クラウドデプロイ手順

## 費用
- GitHub: 無料
- Render（アプリ本体）: 無料
- Render（データ保存ディスク 1GB）: **月額約37円**（$0.25/月）

---

## Step 1: GitHubにアップロード

### 1-1. GitHubアカウントを作成
→ https://github.com/signup（メールアドレスで無料登録）

### 1-2. 新しいリポジトリを作成
1. GitHubにログイン後、右上の「+」→「New repository」
2. 設定：
   - Repository name: `mindtask`
   - Visibility: **Private**（データを非公開にする）
   - 「Create repository」をクリック

### 1-3. コードをGitHubに送信
ターミナルで以下を順番に実行：

```bash
cd /Users/kenta.suda/Desktop/CALUDE_CODE/mindmap_app

git init
git add .
git commit -m "MindTask 初回デプロイ"
git branch -M main
git remote add origin https://github.com/【あなたのGitHubユーザー名】/mindtask.git
git push -u origin main
```

※ GitHubのユーザー名を `【あなたのGitHubユーザー名】` の部分に入れてください。

---

## Step 2: Renderにデプロイ

### 2-1. Renderアカウントを作成
→ https://render.com/（「Get Started for Free」→ GitHubでサインアップが最も簡単）

### 2-2. 新しいWebサービスを作成
1. Renderダッシュボードで「+ New」→「Web Service」
2. 「Connect a repository」→ GitHubと連携
3. `mindtask` リポジトリを選択

### 2-3. サービスの設定
以下の通り入力：

| 項目 | 入力値 |
|------|--------|
| Name | mindtask |
| Region | Singapore（日本に近い） |
| Branch | main |
| Runtime | Python 3 |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `gunicorn app:app --workers 1 --bind 0.0.0.0:$PORT` |
| Instance Type | **Free** |

### 2-4. 環境変数を設定
「Environment Variables」セクションで以下を追加：

| Key | Value |
|-----|-------|
| `NOTION_API_KEY` | （あなたのNotionインテグレーションのシークレットキー） |
| `NOTION_DATABASE_ID` | （あなたのNotionデータベースID） |
| `DATA_DIR` | /data |

### 2-5. データ保存ディスクを追加
「Add Disk」ボタンをクリック：

| 項目 | 入力値 |
|------|--------|
| Name | mindtask-data |
| Mount Path | `/data` |
| Size | 1 GB |

### 2-6. デプロイ開始
「Create Web Service」をクリック → 2〜3分でデプロイ完了

---

## Step 3: アクセス確認

デプロイ完了後、Renderダッシュボードに表示される URL（例: `https://mindtask-xxxx.onrender.com`）を
スマホやPCのブラウザで開く。

---

## 注意事項

| 項目 | 内容 |
|------|------|
| 無料プランの制限 | 15分間アクセスがないと休眠状態になる（次のアクセス時に30秒ほど起動に時間がかかる） |
| データの保存先 | クラウドの `/data` ディスクに保存（PCのデータとは別） |
| セキュリティ | URLを知っている人は誰でもアクセス可能。パスワード設定は別途対応可能 |
| コード更新方法 | `git push` するだけで自動的に再デプロイされる |
