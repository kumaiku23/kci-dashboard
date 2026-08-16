# Weekly Market Pressure Gauge

A capital allocator's weekly weather report, powered by `data.json`. It describes direction, magnitude, breadth, and persistence of market pressure and emerging opportunity; it is not a market-timing signal.

The gauge publishes automatically every Monday at 7:30 AM America/Los_Angeles. Its displayed subtitle is `Week of [Monday date]`; a manual midweek publication retains its actual archive date while displaying the Monday that starts that report week.

## Weekly Publishing Setup

1. Go to Settings -> Secrets and variables -> Actions.
2. Add the repository secret `OPENAI_API_KEY`.
3. To retain the optional GitHub Actions Drive upload, create a Google Cloud service account, enable Google Drive API, create a JSON key, and share the target Drive folder with its service account email as Editor.
4. Add `GOOGLE_SERVICE_ACCOUNT_JSON` and `GOOGLE_DRIVE_FOLDER_ID` as repository secrets.
5. Run the `Weekly Market Pressure Gauge` workflow manually once from the Actions tab.
6. Confirm `data.json`, `history/YYYY-MM-DD.json`, `history/index.json`, `heartbeat.json`, and the date-specific PDF update.

## Local Mac PDF Sync

The local Mac sync archives the published weekly PDF to your Google Drive for Desktop folder while GitHub Actions remains responsible for `data.json` and history publishing.

1. Install Google Drive for Desktop and confirm its target folder is syncing under `~/Library/CloudStorage/`.
2. Optionally copy `.local-dashboard.env.example` to `.local-dashboard.env` and set the KCI folders. The installer can also discover a single Google Drive account and create `KCI/PDFs`, `KCI/JSON`, and `KCI/Monthly`.
3. Run manually: `bash scripts/local-sync-pdf.sh`.
4. Install the schedule: `bash scripts/install-macos-pdf-sync.sh`.
5. Inspect logs: `tail -f logs/local-sync-pdf.out.log`, `tail -f logs/local-sync-pdf.err.log`, or `tail -f logs/local-sync-pdf.runs.log`.
6. Uninstall: `bash scripts/uninstall-macos-pdf-sync.sh`.

The LaunchAgent runs Monday at 8:30 AM, 9:30 AM, and 10:30 AM America/Los_Angeles. Repeated runs are harmless: until Monday's dashboard is published it records `waiting_for_dashboard`; once a valid `YYYY-MM-DD.pdf` is archived it records `already_archived`. Manual Tuesday-Sunday runs record `no_report_expected`. The Mac must be awake and connected to the internet at a scheduled time.
