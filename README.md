# Market Stress Dashboard

Static Market Stress Dashboard powered by `data.json`.

## Daily Publishing Setup

1. Go to Settings → Secrets and variables → Actions.
2. Add a repository secret named `OPENAI_API_KEY`.
3. Create a Google Cloud service account.
4. Enable the Google Drive API.
5. Create a JSON key for the service account.
6. Share the target Google Drive folder with the service account email as Editor.
7. Add a repository secret named `GOOGLE_SERVICE_ACCOUNT_JSON` containing the full JSON key.
8. Add a repository secret named `GOOGLE_DRIVE_FOLDER_ID` containing the target folder ID.
9. Run the "Daily Market Stress Dashboard" workflow manually once from the Actions tab.
10. Confirm `data.json` updates, `history/YYYY-MM-DD.json` exists, `heartbeat.json` updates, and `YYYY-MM-DD.pdf` appears in Drive.

## Local Mac PDF Sync

Use this if you want your Mac to archive the latest dashboard PDF into a Google Drive for Desktop synced folder while GitHub Actions continues handling `data.json` and `history/`.

1. Install Google Drive for Desktop.
2. Confirm Google Drive is syncing under `~/Library/CloudStorage/`.
3. Install the weekday schedule:
   `bash scripts/install-macos-pdf-sync.sh`
4. The installer detects your Google Drive account automatically, creates this folder structure, and writes `.local-dashboard.env`:
   `KCI/PDFs`
   `KCI/JSON`
   `KCI/Monthly`
5. If you want to override the destination manually, copy `.local-dashboard.env.example` to `.local-dashboard.env` and edit the paths before installing.
6. Run manually:
   `bash scripts/local-sync-pdf.sh`
7. Check logs:
   `tail -f logs/local-sync-pdf.out.log`
   `tail -f logs/local-sync-pdf.err.log`
   `tail -f logs/local-sync-pdf.runs.log`
8. Uninstall:
   `bash scripts/uninstall-macos-pdf-sync.sh`

The LaunchAgent runs on weekdays at 8:30 AM, 9:30 AM, and 10:30 AM America/Los_Angeles. This gives GitHub Actions time to finish when its 7:30 AM Pacific dashboard run is delayed. Each run pulls `main`, waits without creating a PDF when `data.json` is not yet dated today, and writes its result to `logs/local-sync-status.json`. Once a valid same-day PDF has been archived, later runs detect the existing file and exit successfully without making a duplicate.

The Mac must be awake and connected to the internet at a scheduled time.
