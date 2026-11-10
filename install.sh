#!/bin/bash
# Orca ウィジェット用サーバーを、この Mac のログイン時に自動で起動するよう登録する。
# もう一度実行すると設定を入れ直して再起動する。
set -euo pipefail

LABEL="local.orca-widget"
DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/orca-widget.log"
PORT="${PORT:-8765}"
ORCA_BIN="${ORCA_BIN:-/Applications/Orca.app/Contents/Resources/bin/orca}"

PYTHON="$(command -v python3 || true)"
if [ -z "$PYTHON" ]; then
  echo "python3 が見つかりません。ターミナルで xcode-select --install を実行してから、もう一度試してください" >&2
  exit 1
fi
if [ ! -x "$ORCA_BIN" ]; then
  echo "Orca が見つかりません（$ORCA_BIN）。Orca を /Applications に入れてください" >&2
  exit 1
fi
# Tailscale の IP（100.64.0.0/10）。server.py と同じく ifconfig から探す
IP="$(/sbin/ifconfig | awk '$1=="inet"{split($2,o,"."); if(o[1]==100 && o[2]>=64 && o[2]<=127){print $2; exit}}')"
if [ -z "$IP" ]; then
  echo "Tailscale の IP が取れません。Tailscale を入れてログインしてから、もう一度試してください" >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PYTHON</string>
    <string>$DIR/server.py</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>$PORT</string>
    <key>ORCA_BIN</key><string>$ORCA_BIN</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <!-- Tailscale がつながる前は起動に失敗するので、30 秒おきに再試行 -->
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

URL="http://$IP:$PORT/status"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -fs -o /dev/null "http://$IP:$PORT/healthz" && break
  sleep 1
done
if curl -fs -o /dev/null "http://$IP:$PORT/healthz"; then
  echo "起動しました: $URL"
else
  echo "登録しましたが、まだ応答がありません。ログを確認してください: $LOG" >&2
fi
echo
echo "iPhone の Scriptable のウィジェット設定で、Parameter に次の IP を入れてください:"
echo "  $IP"
