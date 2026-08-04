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
