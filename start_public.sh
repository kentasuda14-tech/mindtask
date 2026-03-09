#!/bin/bash
# MindTask 公開起動スクリプト
# スマホ・どこからでもアクセス可能なURLを生成します

set -e

cd "$(dirname "$0")"

# ===== ngrokの確認 =====
if ! command -v ngrok &> /dev/null; then
  echo ""
  echo "【エラー】ngrokがインストールされていません。"
  echo ""
  echo "以下の手順でインストールしてください："
  echo "  1. https://ngrok.com/download を開く"
  echo "  2. macOS版をダウンロードして解凍"
  echo "  3. 解凍した「ngrok」ファイルを /usr/local/bin/ に移動："
  echo "     sudo mv ~/Downloads/ngrok /usr/local/bin/"
  echo "  4. https://dashboard.ngrok.com/signup で無料アカウントを作成"
  echo "  5. ダッシュボードに表示される「Your Authtoken」をコピー"
  echo "  6. 以下を実行（TOKENをあなたのトークンに置き換え）："
  echo "     ngrok config add-authtoken TOKEN"
  echo ""
  echo "設定後、もう一度このスクリプトを実行してください。"
  exit 1
fi

# ===== Flaskサーバーを起動（バックグラウンド）=====
echo ""
echo "=================================================="
echo "  MindTask を起動しています..."
echo "=================================================="

python3 app.py &
FLASK_PID=$!

# Flaskの起動を待つ
sleep 2

# Flaskが正常に起動したか確認
if ! kill -0 $FLASK_PID 2>/dev/null; then
  echo "【エラー】Flaskの起動に失敗しました。"
  exit 1
fi

echo "  Flask: 起動完了"

# ===== ngrokでトンネルを開く =====
echo "  ngrok: 公開URLを生成中..."

ngrok http 5001 --log=stdout --log-format=json > /tmp/mindtask_ngrok.log 2>&1 &
NGROK_PID=$!

# ngrokの起動を待って公開URLを取得
sleep 3

PUBLIC_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['tunnels'][0]['public_url'])" 2>/dev/null || echo "")

echo ""
echo "=================================================="
if [ -n "$PUBLIC_URL" ]; then
  echo "  接続URL（スマホ・PC どこからでも使えます）"
  echo ""
  echo "  $PUBLIC_URL"
  echo ""
  echo "  ※ QRコードを表示したい場合："
  echo "     qrencode -t ANSIUTF8 '$PUBLIC_URL'"
  echo ""
  echo "  ⚠ このURLはセッション中のみ有効です"
  echo "  ⚠ スクリプトを終了するとURLは無効になります"
else
  echo "  【注意】公開URLの自動取得に失敗しました。"
  echo "  ブラウザで http://localhost:4040 を開いて"
  echo "  表示されているURLをスマホで使用してください。"
fi
echo "=================================================="
echo ""
echo "  終了するには Ctrl+C を押してください"
echo ""

# Ctrl+C で両方を終了
cleanup() {
  echo ""
  echo "終了しています..."
  kill $FLASK_PID 2>/dev/null
  kill $NGROK_PID 2>/dev/null
  echo "終了しました。"
  exit 0
}

trap cleanup INT TERM

# 両プロセスが動いている間待機
wait $FLASK_PID
