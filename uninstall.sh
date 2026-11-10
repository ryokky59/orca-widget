#!/bin/bash
# install.sh で登録したサーバーを止めて、自動起動の登録を消す。
set -uo pipefail
LABEL="local.orca-widget"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "止めて登録を消しました（ログ ~/Library/Logs/orca-widget.log は残しています）"
