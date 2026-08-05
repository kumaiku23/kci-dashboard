#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "Error: $*" >&2
  exit 1
}

repo_root() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
  cd "$script_dir/.." && pwd -P
}

escape_sed_replacement() {
  printf '%s' "$1" | sed 's/[\/&]/\\&/g'
}

main() {
  local root template launch_agents plist repo_escaped home_escaped
  root="$(repo_root)"
  template="$root/macos/com.kci.dashboard-pdf-sync.plist.example"
  launch_agents="$HOME/Library/LaunchAgents"
  plist="$launch_agents/com.kci.dashboard-pdf-sync.plist"

  [[ -f "$root/.local-dashboard.env" ]] || fail "Missing $root/.local-dashboard.env. Configure it before installing the LaunchAgent."
  [[ -f "$template" ]] || fail "Missing LaunchAgent template: $template"

  mkdir -p "$root/logs" "$launch_agents"

  repo_escaped="$(escape_sed_replacement "$root")"
  home_escaped="$(escape_sed_replacement "$HOME")"
  sed \
    -e "s/__REPO_PATH__/$repo_escaped/g" \
    -e "s/__HOME_PATH__/$home_escaped/g" \
    "$template" > "$plist"

  plutil -lint "$plist"

  launchctl unload "$plist" >/dev/null 2>&1 || true
  launchctl load "$plist"

  cat <<INFO
Installed LaunchAgent: $plist

Run manually:
  bash "$root/scripts/local-sync-pdf.sh"

Inspect status:
  launchctl list | grep com.kci.dashboard-pdf-sync

Inspect logs:
  tail -f "$root/logs/local-sync-pdf.out.log"
  tail -f "$root/logs/local-sync-pdf.err.log"

Uninstall:
  bash "$root/scripts/uninstall-macos-pdf-sync.sh"
INFO
}

main "$@"
