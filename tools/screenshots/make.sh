#!/bin/bash
# README 用のスクリーンショットを作る（docs/*.png）。Google Chrome が必要。
# OrcaStatus.js をブラウザ上の Scriptable もどきで、デモのデータ（Parameter: demo）で描く。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cp "$HERE/page.html" "$HERE/emulator.js" "$TMP/"
python3 -c 'import json,sys; print("window.WIDGET_SRC = " + json.dumps(open(sys.argv[1]).read()) + ";")' \
  "$ROOT/OrcaStatus.js" > "$TMP/widget-src.js"
mkdir -p "$ROOT/docs"

shot() { # view 幅 高さ 出力
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --virtual-time-budget=5000 --window-size="$2,$3" \
    --screenshot="$ROOT/docs/$4" "file://$TMP/page.html?view=$1" >/dev/null 2>&1
  echo "docs/$4"
}
shot home-light 756 410 home-light.png
shot home-dark 756 410 home-dark.png
shot lock 460 290 lock.png
