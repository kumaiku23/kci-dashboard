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
2. Confirm the target Google Drive folder is syncing locally.
3. Copy `.local-dashboard.env.example` to `.local-dashboard.env`.
4. Set `GOOGLE_DRIVE_PDF_DIR` to the synced folder path.
5. Run manually:
   `bash scripts/local-sync-pdf.sh`
6. Install the weekday 2:15 PM schedule:
   `bash scripts/install-macos-pdf-sync.sh`
7. Check logs:
   `tail -f logs/local-sync-pdf.out.log`
   `tail -f logs/local-sync-pdf.err.log`
8. Uninstall:
   `bash scripts/uninstall-macos-pdf-sync.sh`

The Mac must be awake and connected to the internet at the scheduled time.
