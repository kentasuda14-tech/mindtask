# MindTask 運用ガイド

## アプリURL
**https://kentasuda.pythonanywhere.com**
（スマホ・PC・外出先どこからでもアクセス可能）

---

## 新しいデバイスで使い始める

**ブラウザでURLを開くだけ。インストール不要。**

スマホのホーム画面に追加しておくと便利：
- iPhone: Safari で開く → 共有ボタン → 「ホーム画面に追加」
- Android: Chrome で開く → メニュー → 「ホーム画面に追加」

---

## アプリを改善・変更したあとの反映手順

コードを変更してGitHubにプッシュした後、PythonAnywhereに反映させる手順。

### 1. ローカルで変更をコミット＆プッシュ（PC側）

```bash
cd /Users/kenta.suda/Desktop/CALUDE_CODE/mindmap_app
git add -A
git commit -m "変更内容のメモ"
git push origin main
```

### 2. PythonAnywhereに反映（ブラウザ側）

PythonAnywhere (https://www.pythonanywhere.com) にログインして Bash コンソールを開き：

```bash
cd ~/mindtask && git pull && touch /var/www/kentasuda_pythonanywhere_com_wsgi.py
```

### 3. ブラウザを強制リロード

- PC: `Ctrl+Shift+R`（Windows）/ `Cmd+Shift+R`（Mac）
- スマホ: キャッシュをクリアするか、シークレットモードで開く

> **注意**: 通常のリロード（F5）ではJSファイルのキャッシュが残ることがある。
> 必ず強制リロードすること。

### キャッシュ問題が起きたら

`mindmap.js?v=3` のような番号を上げると、全ブラウザが強制的に最新版を読み込む。
`mindmap_app/templates/index.html` の最終行を編集：

```html
<!-- v=3 → v=4 に変更 -->
<script src="/static/mindmap.js?v=4"></script>
```

---

## トラブルシューティング

### ボタンが効かない / タスク一覧が表示されない

→ **ブラウザのキャッシュ問題**。強制リロード（`Cmd+Shift+R`）で解決。

### データが消えた

→ PythonAnywhereの無料プランは永続ストレージ512MB。データは `~/mindtask/mindmap_app/data/documents.json` に保存されている。ファイルが消えていないか確認：
```bash
cat ~/mindtask/mindmap_app/data/documents.json | head -20
```

### PythonAnywhereがスリープしている（3ヶ月ごと）

無料プランは3ヶ月ごとに手動で再起動が必要。
PythonAnywhere の Web タブで「Run until 3 months from today」ボタンを押す。

### アプリにアクセスできない（500エラーなど）

PythonAnywhere の Web タブ → Error log を確認する。

---

## 開発環境（ローカルで動かす場合）

```bash
cd /Users/kenta.suda/Desktop/CALUDE_CODE/mindmap_app
pip3 install flask python-dotenv
python3 app.py
# → ブラウザで http://localhost:5001 を開く
```

ローカルのデータは `mindmap_app/data/documents.json` に保存される（本番とは別）。

---

## ファイル構成メモ

| ファイル | 役割 |
|---------|------|
| `app.py` | バックエンド（Flask） |
| `templates/index.html` | 画面のHTML |
| `static/mindmap.js` | フロントエンドの全ロジック |
| `static/style.css` | デザイン |
| `data/documents.json` | データ保存先（自動生成） |

---

## GitHubリポジトリ

https://github.com/kentasuda14-tech/mindtask
