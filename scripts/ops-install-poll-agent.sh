#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOME_DIR="${HOME}"
PLIST_SRC="$ROOT/deploy/com.petfix.ops-poll.plist.template"
PLIST_DST="$HOME_DIR/Library/LaunchAgents/com.petfix.ops-poll.plist"
POLL_SCRIPT="$ROOT/scripts/ops-poll-launchd.sh"

chmod +x "$ROOT/scripts/ops-bootstrap.sh" "$POLL_SCRIPT"

sed \
  -e "s|__ROOT__|$ROOT|g" \
  -e "s|__HOME__|$HOME_DIR|g" \
  "$PLIST_SRC" > "$PLIST_DST"

launchctl bootout "gui/$(id -u)/com.petfix.ops-poll" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"
launchctl enable "gui/$(id -u)/com.petfix.ops-poll"
launchctl kickstart -k "gui/$(id -u)/com.petfix.ops-poll"

echo "LaunchAgent yüklendi: com.petfix.ops-poll (120s)"
echo "Log: $HOME_DIR/Library/Logs/petfix-ops-poll.log"
