#!/usr/bin/env bash
set -euo pipefail

plist="$HOME/Library/LaunchAgents/com.kci.dashboard-pdf-sync.plist"

if [[ -f "$plist" ]]; then
  launchctl unload "$plist" >/dev/null 2>&1 || true
  rm -f "$plist"
  echo "Removed LaunchAgent: $plist"
else
  echo "LaunchAgent is not installed: $plist"
fi

echo "PDFs and logs were left untouched."
