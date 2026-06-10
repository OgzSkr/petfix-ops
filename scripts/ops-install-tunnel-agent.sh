#!/usr/bin/env bash
set -euo pipefail
SUPPORT="$HOME/Library/Application Support/PetFix"
PLIST="$HOME/Library/LaunchAgents/com.petfix.ops-tunnel.plist"
SCRIPT_SRC="$(cd "$(dirname "$0")/.." && pwd)/scripts/ops-tunnel-launchd.sh"

mkdir -p "$SUPPORT"
cp "$SCRIPT_SRC" "$SUPPORT/ops-tunnel-launchd.sh"
chmod +x "$SUPPORT/ops-tunnel-launchd.sh"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.petfix.ops-tunnel</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$SUPPORT/ops-tunnel-launchd.sh</string>
  </array>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$HOME/Library/Logs/petfix-ops-tunnel.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/Library/Logs/petfix-ops-tunnel.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/com.petfix.ops-tunnel" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Tunnel LaunchAgent yüklendi. URL: $SUPPORT/tunnel-url.txt"
