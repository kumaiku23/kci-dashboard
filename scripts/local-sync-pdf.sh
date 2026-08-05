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

require_clean_worktree() {
  if [[ -n "$(git status --porcelain)" ]]; then
    fail "Working tree has uncommitted changes. Commit, stash, or discard them before syncing the dashboard PDF."
  fi
}

load_local_config() {
  local root="$1"
  local config="$root/.local-dashboard.env"
  [[ -f "$config" ]] || fail "Missing $config. Copy .local-dashboard.env.example to .local-dashboard.env and set GOOGLE_DRIVE_PDF_DIR."
  # shellcheck disable=SC1090
  source "$config"
  [[ -n "${GOOGLE_DRIVE_PDF_DIR:-}" ]] || fail "GOOGLE_DRIVE_PDF_DIR is required in .local-dashboard.env."
  DASHBOARD_PORT="${DASHBOARD_PORT:-8080}"
}

detect_chrome() {
  local mac_chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  if [[ "${KCI_TEST_DISABLE_MAC_CHROME:-}" != "1" && -x "$mac_chrome" ]]; then
    echo "$mac_chrome"
    return 0
  fi

  local candidate
  for candidate in google-chrome chromium chromium-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done

  fail "Google Chrome or Chromium was not found. Install Google Chrome, or add google-chrome/chromium/chromium-browser to PATH."
}

report_date_to_iso() {
  local report_date="$1"
  node -e '
    const input = process.argv[1];
    const parsed = new Date(`${input} 12:00:00 GMT-0700`);
    if (Number.isNaN(parsed.valueOf())) {
      console.error(`Could not parse report date: ${input}`);
      process.exit(1);
    }
    const iso = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(parsed);
    console.log(iso);
  ' "$report_date"
}

pdf_size_bytes() {
  local file="$1"
  if stat -f%z "$file" >/dev/null 2>&1; then
    stat -f%z "$file"
  else
    stat -c%s "$file"
  fi
}

validate_pdf() {
  local pdf_path="$1"
  [[ -f "$pdf_path" ]] || fail "PDF was not generated: $pdf_path"
  local size
  size="$(pdf_size_bytes "$pdf_path")"
  [[ "$size" -gt 10240 ]] || fail "PDF is too small: $pdf_path is ${size} bytes; expected more than 10240 bytes."
  echo "$size"
}

copy_pdf_to_destination() {
  local source_pdf="$1"
  local destination_dir="$2"
  local iso_date="$3"
  mkdir -p "$destination_dir"
  cp -f "$source_pdf" "$destination_dir/$iso_date.pdf"
}

pull_latest_main() {
  git fetch origin
  require_clean_worktree
  git checkout main
  git pull --ff-only origin main
}

main() {
  local root
  root="$(repo_root)"
  cd "$root"

  load_local_config "$root"
  pull_latest_main

  local report_date iso_date chrome tmp_dir tmp_pdf dest_pdf server_pid pdf_size
  report_date="$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync("data.json","utf8")); console.log(d.date);')"
  iso_date="$(report_date_to_iso "$report_date")"
  chrome="$(detect_chrome)"

  mkdir -p "$GOOGLE_DRIVE_PDF_DIR" "$root/logs"
  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/kci-dashboard-pdf.XXXXXX")"
  tmp_pdf="$tmp_dir/$iso_date.pdf"
  dest_pdf="$GOOGLE_DRIVE_PDF_DIR/$iso_date.pdf"

  cleanup() {
    if [[ -n "${server_pid:-}" ]]; then
      kill "$server_pid" >/dev/null 2>&1 || true
    fi
    rm -rf "$tmp_dir"
  }
  trap cleanup EXIT

  python3 -m http.server "$DASHBOARD_PORT" --bind 127.0.0.1 > "$root/logs/local-sync-pdf.http.log" 2>&1 &
  server_pid="$!"

  for _ in 1 2 3 4 5; do
    if curl -fsS "http://127.0.0.1:$DASHBOARD_PORT/" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  "$chrome" --headless --disable-gpu --no-sandbox --print-to-pdf="$tmp_pdf" "http://127.0.0.1:$DASHBOARD_PORT/"
  pdf_size="$(validate_pdf "$tmp_pdf")"
  copy_pdf_to_destination "$tmp_pdf" "$GOOGLE_DRIVE_PDF_DIR" "$iso_date"

  cat <<SUMMARY
PDF sync complete.
Report date: $report_date
Source repo: $root
Destination path: $dest_pdf
PDF size: $pdf_size bytes
SUMMARY
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
