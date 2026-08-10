#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "Error: $*" >&2
  exit 1
}

KCI_SYNC_TMP_DIR=""
KCI_SYNC_SERVER_PID=""
KCI_SYNC_ROOT=""
KCI_SYNC_ATTEMPT_TIME=""
KCI_SYNC_EXPECTED_DATE=""
KCI_SYNC_DASHBOARD_DATE=""
KCI_SYNC_STATUS_WRITTEN="false"

cleanup_local_sync() {
  if [[ -n "${KCI_SYNC_SERVER_PID:-}" ]]; then
    kill "$KCI_SYNC_SERVER_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${KCI_SYNC_TMP_DIR:-}" ]]; then
    rm -rf "$KCI_SYNC_TMP_DIR"
  fi
}

write_local_status() {
  local status="$1"
  local pdf_name="${2:-}"
  local status_file
  status_file="$KCI_SYNC_ROOT/logs/local-sync-status.json"

  mkdir -p "$KCI_SYNC_ROOT/logs"
  node -e '
    const fs = require("fs");
    const [file, lastAttempt, expectedDate, dashboardDate, status, pdf] = process.argv.slice(1);
    fs.writeFileSync(file, `${JSON.stringify({
      lastAttempt,
      expectedDate,
      dashboardDate,
      status,
      pdf: pdf || null
    }, null, 2)}\n`);
  ' "$status_file" "$KCI_SYNC_ATTEMPT_TIME" "$KCI_SYNC_EXPECTED_DATE" "$KCI_SYNC_DASHBOARD_DATE" "$status" "$pdf_name"
  KCI_SYNC_STATUS_WRITTEN="true"
}

log_local_attempt() {
  local result="$1"
  local destination_pdf="${2:-}"
  mkdir -p "$KCI_SYNC_ROOT/logs"
  printf '%s | dashboard=%s | expected=%s | destination=%s | result=%s\n' \
    "$KCI_SYNC_ATTEMPT_TIME" \
    "${KCI_SYNC_DASHBOARD_DATE:-unknown}" \
    "${KCI_SYNC_EXPECTED_DATE:-unknown}" \
    "${destination_pdf:-none}" \
    "$result" >> "$KCI_SYNC_ROOT/logs/local-sync-pdf.runs.log"
}

finish_local_sync() {
  local exit_code="$?"
  cleanup_local_sync

  if [[ "$exit_code" -ne 0 && "$KCI_SYNC_STATUS_WRITTEN" != "true" && -n "$KCI_SYNC_ROOT" ]]; then
    write_local_status "error" "${KCI_SYNC_EXPECTED_DATE:-unknown}.pdf" || true
    log_local_attempt "error" "${GOOGLE_DRIVE_PDF_DIR:-}" || true
  fi

  exit "$exit_code"
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
  if [[ ! -f "$config" ]]; then
    echo "No .local-dashboard.env found; detecting Google Drive automatically."
    initialize_local_config "$root"
  fi
  ensure_local_config "$root"
  # shellcheck disable=SC1090
  source "$config"
  [[ -n "${GOOGLE_DRIVE_PDF_DIR:-}" ]] || fail "GOOGLE_DRIVE_PDF_DIR is required in .local-dashboard.env."
  [[ -n "${GOOGLE_DRIVE_JSON_DIR:-}" ]] || fail "GOOGLE_DRIVE_JSON_DIR is required in .local-dashboard.env."
  [[ -n "${GOOGLE_DRIVE_MONTHLY_DIR:-}" ]] || fail "GOOGLE_DRIVE_MONTHLY_DIR is required in .local-dashboard.env."
  DASHBOARD_PORT="${DASHBOARD_PORT:-8080}"
}

cloud_storage_root() {
  echo "${KCI_CLOUD_STORAGE_ROOT:-$HOME/Library/CloudStorage}"
}

google_drive_content_root() {
  local drive_root="$1"
  if [[ -d "$drive_root/My Drive" ]]; then
    echo "$drive_root/My Drive"
  else
    echo "$drive_root"
  fi
}

find_google_drive_dirs() {
  local cloud_root="$1"
  [[ -d "$cloud_root" ]] || return 0
  find "$cloud_root" -maxdepth 1 -type d -name 'GoogleDrive*' -print | sort
}

select_google_drive_root() {
  local cloud_root
  cloud_root="$(cloud_storage_root)"
  local drives=()
  local drive
  while IFS= read -r drive; do
    [[ -n "$drive" ]] && drives+=("$drive")
  done < <(find_google_drive_dirs "$cloud_root")

  if [[ "${#drives[@]}" -eq 0 ]]; then
    fail "Google Drive for Desktop was not found in $cloud_root. Install Google Drive for Desktop and sign in before installing PDF sync."
  fi

  if [[ "${#drives[@]}" -eq 1 ]]; then
    echo "${drives[0]}"
    return 0
  fi

  echo "Multiple Google Drive accounts were found:" >&2
  local i
  for i in "${!drives[@]}"; do
    echo "  $((i + 1))) ${drives[$i]}" >&2
  done

  local selection="${KCI_GOOGLE_DRIVE_SELECTION:-}"
  if [[ -z "$selection" ]]; then
    read -r -p "Choose Google Drive account [1-${#drives[@]}]: " selection
  fi

  if ! [[ "$selection" =~ ^[0-9]+$ ]] || [[ "$selection" -lt 1 ]] || [[ "$selection" -gt "${#drives[@]}" ]]; then
    fail "Invalid Google Drive selection: $selection"
  fi

  echo "${drives[$((selection - 1))]}"
}

create_kci_drive_dirs() {
  local drive_root="$1"
  local content_root
  content_root="$(google_drive_content_root "$drive_root")"
  mkdir -p "$content_root/KCI/PDFs" "$content_root/KCI/JSON" "$content_root/KCI/Monthly"
}

write_local_config() {
  local root="$1"
  local drive_root="$2"
  local content_root config
  content_root="$(google_drive_content_root "$drive_root")"
  config="$root/.local-dashboard.env"
  cat > "$config" <<CONFIG
GOOGLE_DRIVE_PDF_DIR="$content_root/KCI/PDFs"
GOOGLE_DRIVE_JSON_DIR="$content_root/KCI/JSON"
GOOGLE_DRIVE_MONTHLY_DIR="$content_root/KCI/Monthly"
DASHBOARD_PORT=8080
CONFIG
}

initialize_local_config() {
  local root="$1"
  local drive_root
  drive_root="$(select_google_drive_root)"
  create_kci_drive_dirs "$drive_root"
  write_local_config "$root" "$drive_root"
}

ensure_local_config() {
  local root="$1"
  local config="$root/.local-dashboard.env"
  # shellcheck disable=SC1090
  source "$config"

  if [[ -z "${GOOGLE_DRIVE_PDF_DIR:-}" ]]; then
    initialize_local_config "$root"
    return 0
  fi

  local kci_root
  kci_root="$(dirname "$GOOGLE_DRIVE_PDF_DIR")"
  GOOGLE_DRIVE_JSON_DIR="${GOOGLE_DRIVE_JSON_DIR:-$kci_root/JSON}"
  GOOGLE_DRIVE_MONTHLY_DIR="${GOOGLE_DRIVE_MONTHLY_DIR:-$kci_root/Monthly}"
  DASHBOARD_PORT="${DASHBOARD_PORT:-8080}"

  mkdir -p "$GOOGLE_DRIVE_PDF_DIR" "$GOOGLE_DRIVE_JSON_DIR" "$GOOGLE_DRIVE_MONTHLY_DIR"
  cat > "$config" <<CONFIG
GOOGLE_DRIVE_PDF_DIR="$GOOGLE_DRIVE_PDF_DIR"
GOOGLE_DRIVE_JSON_DIR="$GOOGLE_DRIVE_JSON_DIR"
GOOGLE_DRIVE_MONTHLY_DIR="$GOOGLE_DRIVE_MONTHLY_DIR"
DASHBOARD_PORT=$DASHBOARD_PORT
CONFIG
}

today_pdf_is_complete() {
  local pdf_path="$1"
  [[ -f "$pdf_path" ]] || return 1
  local size
  size="$(pdf_size_bytes "$pdf_path")"
  [[ "$size" -gt 10240 ]]
}

remove_incomplete_pdf() {
  local pdf_path="$1"
  if [[ -f "$pdf_path" ]]; then
    local size
    size="$(pdf_size_bytes "$pdf_path")"
    if [[ "$size" -le 10240 ]]; then
      rm -f "$pdf_path"
    fi
  fi
}

detect_chrome() {
  if [[ -n "${KCI_SYNC_CHROME_BIN:-}" && -x "$KCI_SYNC_CHROME_BIN" ]]; then
    echo "$KCI_SYNC_CHROME_BIN"
    return 0
  fi

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
  if [[ "${KCI_SYNC_SKIP_PULL:-}" = "1" ]]; then
    return 0
  fi
  git fetch origin
  require_clean_worktree
  git checkout main
  git pull --ff-only origin main
}

today_iso_date() {
  if [[ -n "${KCI_SYNC_TEST_TODAY_ISO:-}" ]]; then
    echo "$KCI_SYNC_TEST_TODAY_ISO"
    return 0
  fi
  TZ=America/Los_Angeles date +%Y-%m-%d
}

attempt_timestamp() {
  if [[ -n "${KCI_SYNC_TEST_ATTEMPT_TIME:-}" ]]; then
    echo "$KCI_SYNC_TEST_ATTEMPT_TIME"
    return 0
  fi
  TZ=America/Los_Angeles date '+%Y-%m-%dT%H:%M:%S%z' | sed -E 's/([+-][0-9]{2})([0-9]{2})$/\1:\2/'
}

main() {
  local root
  root="${KCI_SYNC_TEST_ROOT:-$(repo_root)}"
  cd "$root"

  KCI_SYNC_ROOT="$root"
  KCI_SYNC_ATTEMPT_TIME="$(attempt_timestamp)"
  KCI_SYNC_EXPECTED_DATE="$(today_iso_date)"
  trap finish_local_sync EXIT

  load_local_config "$root"
  pull_latest_main

  local start_seconds report_date dashboard_date chrome tmp_dir tmp_pdf dest_pdf pdf_size elapsed_seconds
  start_seconds="$(date +%s)"
  report_date="$(node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync("data.json","utf8")); console.log(d.date);')"
  dashboard_date="$(report_date_to_iso "$report_date")"
  KCI_SYNC_DASHBOARD_DATE="$dashboard_date"

  mkdir -p "$GOOGLE_DRIVE_PDF_DIR" "$root/logs"
  dest_pdf="$GOOGLE_DRIVE_PDF_DIR/$KCI_SYNC_EXPECTED_DATE.pdf"

  if [[ "$KCI_SYNC_DASHBOARD_DATE" != "$KCI_SYNC_EXPECTED_DATE" ]]; then
    write_local_status "waiting_for_dashboard" "$KCI_SYNC_EXPECTED_DATE.pdf"
    log_local_attempt "waiting_for_dashboard" "$dest_pdf"
    cat <<SUMMARY
Dashboard has not published today's report yet.
Expected: $KCI_SYNC_EXPECTED_DATE
Found: $KCI_SYNC_DASHBOARD_DATE
Will retry at the next scheduled sync.
SUMMARY
    exit 0
  fi

  if today_pdf_is_complete "$dest_pdf"; then
    pdf_size="$(pdf_size_bytes "$dest_pdf")"
    write_local_status "already_archived" "$KCI_SYNC_EXPECTED_DATE.pdf"
    log_local_attempt "already_archived" "$dest_pdf"
    elapsed_seconds="$(( $(date +%s) - start_seconds ))"
    cat <<SUMMARY
✓ Today's PDF already exists. Nothing to do.

Report date: $report_date
Destination folder: $GOOGLE_DRIVE_PDF_DIR
PDF filename: $KCI_SYNC_EXPECTED_DATE.pdf
PDF size: $pdf_size bytes
Elapsed time: ${elapsed_seconds}s
SUMMARY
    exit 0
  fi
  remove_incomplete_pdf "$dest_pdf"
  chrome="$(detect_chrome)"

  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/kci-dashboard-pdf.XXXXXX")"
  tmp_pdf="$tmp_dir/$KCI_SYNC_EXPECTED_DATE.pdf"
  KCI_SYNC_TMP_DIR="$tmp_dir"

  python3 -m http.server "$DASHBOARD_PORT" --bind 127.0.0.1 > "$root/logs/local-sync-pdf.http.log" 2>&1 &
  KCI_SYNC_SERVER_PID="$!"

  for _ in 1 2 3 4 5; do
    if curl -fsS "http://127.0.0.1:$DASHBOARD_PORT/" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  "$chrome" --headless --disable-gpu --no-sandbox --print-to-pdf="$tmp_pdf" "http://127.0.0.1:$DASHBOARD_PORT/"
  pdf_size="$(validate_pdf "$tmp_pdf")"
  copy_pdf_to_destination "$tmp_pdf" "$GOOGLE_DRIVE_PDF_DIR" "$KCI_SYNC_EXPECTED_DATE"
  write_local_status "success" "$KCI_SYNC_EXPECTED_DATE.pdf"
  log_local_attempt "success" "$dest_pdf"
  elapsed_seconds="$(( $(date +%s) - start_seconds ))"

  cat <<SUMMARY
✓ Dashboard archived successfully

Report date: $report_date
Destination folder: $GOOGLE_DRIVE_PDF_DIR
PDF filename: $KCI_SYNC_EXPECTED_DATE.pdf
PDF size: $pdf_size bytes
Elapsed time: ${elapsed_seconds}s
SUMMARY
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
