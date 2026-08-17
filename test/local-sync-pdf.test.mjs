import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const scriptPath = path.resolve("scripts/local-sync-pdf.sh");
const plistTemplatePath = path.resolve("macos/com.kci.dashboard-pdf-sync.plist.example");
const dailyWorkflowPath = path.resolve(".github/workflows/daily-dashboard.yml");
const installerPath = path.resolve("scripts/install-macos-pdf-sync.sh");

function shellQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function runFunction(command, options = {}) {
  return spawnSync("/bin/bash", ["-c", `source ${shellQuote(scriptPath)}; ${command}`], {
    cwd: path.resolve("."),
    env: { ...process.env, ...options.env },
    encoding: "utf8"
  });
}

function runLocalSync(options = {}) {
  return spawnSync("/bin/bash", [scriptPath], {
    cwd: path.resolve("."),
    env: { ...process.env, ...options.env },
    encoding: "utf8"
  });
}

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), "kci-local-sync-test-"));
}

async function createSyncFixture(reportDate) {
  const root = await tempDir();
  const driveDir = path.join(root, "drive", "KCI", "PDFs");
  const chromePath = path.join(root, "fake-chrome.sh");

  await mkdir(driveDir, { recursive: true });
  await writeFile(path.join(root, "data.json"), JSON.stringify({ date: reportDate }));
  await writeFile(path.join(root, "index.html"), "<title>Dashboard</title>");
  await writeFile(
    path.join(root, ".local-dashboard.env"),
    [
      `GOOGLE_DRIVE_PDF_DIR=${JSON.stringify(driveDir)}`,
      `GOOGLE_DRIVE_JSON_DIR=${JSON.stringify(path.join(root, "drive", "KCI", "JSON"))}`,
      `GOOGLE_DRIVE_MONTHLY_DIR=${JSON.stringify(path.join(root, "drive", "KCI", "Monthly"))}`,
      "DASHBOARD_PORT=18999"
    ].join("\n")
  );
  await writeFile(
    chromePath,
    "#!/bin/sh\nfor arg in \"$@\"; do case \"$arg\" in --print-to-pdf=*) output=${arg#--print-to-pdf=};; esac; done\nhead -c 10241 /dev/zero > \"$output\"\n"
  );
  await chmod(chromePath, 0o755);

  return { root, driveDir, chromePath };
}

function syncEnvironment(fixture, attemptTime = "2026-08-10T15:30:01-07:00") {
  return {
    KCI_SYNC_TEST_ROOT: fixture.root,
    KCI_SYNC_SKIP_PULL: "1",
    KCI_SYNC_TEST_TODAY_ISO: "2026-08-10",
    KCI_SYNC_TEST_ATTEMPT_TIME: attemptTime,
    KCI_SYNC_TEST_WEEKDAY: "1",
    KCI_SYNC_CHROME_BIN: fixture.chromePath
  };
}

async function readLocalStatus(fixture) {
  return JSON.parse(await readFile(path.join(fixture.root, "logs", "local-sync-status.json"), "utf8"));
}

test("report date conversion returns YYYY-MM-DD", () => {
  const result = runFunction("report_date_to_iso 'August 4, 2026'");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "2026-08-04");
});

test("missing Drive directory configuration is rejected", async () => {
  const root = await tempDir();
  const cloudRoot = path.join(root, "CloudStorage");
  await mkdir(cloudRoot);
  const result = runFunction(`load_local_config ${shellQuote(root)}`, {
    env: { KCI_CLOUD_STORAGE_ROOT: cloudRoot }
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Google Drive for Desktop was not found/);
});

test("dirty git working tree is rejected", async () => {
  const root = await tempDir();
  spawnSync("git", ["init"], { cwd: root, encoding: "utf8" });
  await writeFile(path.join(root, "untracked.txt"), "dirty");

  const result = runFunction(`cd ${shellQuote(root)}; require_clean_worktree`);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Working tree has uncommitted changes/);
});

test("missing Chrome is rejected", () => {
  const result = runFunction("detect_chrome", {
    env: {
      KCI_TEST_DISABLE_MAC_CHROME: "1",
      PATH: "/nonexistent"
    }
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Google Chrome or Chromium was not found/);
});

test("PDF size validation rejects undersized PDFs", async () => {
  const root = await tempDir();
  const pdfPath = path.join(root, "small.pdf");
  await writeFile(pdfPath, "tiny");

  const result = runFunction(`validate_pdf ${shellQuote(pdfPath)}`);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /PDF is too small/);
});

test("same-day PDF is replaced in destination", async () => {
  const root = await tempDir();
  const source = path.join(root, "source.pdf");
  const destination = path.join(root, "drive");
  await writeFile(source, "new pdf");
  await writeFile(path.join(root, "old.pdf"), "old pdf");
  await runFunction(`mkdir -p ${shellQuote(destination)}; cp ${shellQuote(path.join(root, "old.pdf"))} ${shellQuote(path.join(destination, "2026-08-04.pdf"))}`);

  const result = runFunction(`copy_pdf_to_destination ${shellQuote(source)} ${shellQuote(destination)} 2026-08-04`);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(path.join(destination, "2026-08-04.pdf"), "utf8"), "new pdf");
});

test("complete same-day PDF is detected for skip", async () => {
  const root = await tempDir();
  const pdfPath = path.join(root, "2026-08-04.pdf");
  await writeFile(pdfPath, Buffer.alloc(10241, "x"));

  const result = runFunction(`today_pdf_is_complete ${shellQuote(pdfPath)}`);

  assert.equal(result.status, 0, result.stderr);
});

test("cleanup trap tolerates unset temp directory", () => {
  const result = runFunction("cleanup_local_sync");

  assert.equal(result.status, 0, result.stderr);
});

test("Monday schedules use the intended Pacific retry windows", async () => {
  const [plist, workflow] = await Promise.all([
    readFile(plistTemplatePath, "utf8"),
    readFile(dailyWorkflowPath, "utf8")
  ]);
  const scheduleEntries = [...plist.matchAll(/<key>Weekday<\/key><integer>(\d+)<\/integer><key>Hour<\/key><integer>(\d+)<\/integer><key>Minute<\/key><integer>(\d+)<\/integer>/g)]
    .map(([, weekday, hour, minute]) => ({ weekday: Number(weekday), hour: Number(hour), minute: Number(minute) }));
  assert.deepEqual(scheduleEntries, [
    { weekday: 1, hour: 8, minute: 30 },
    { weekday: 1, hour: 9, minute: 30 },
    { weekday: 1, hour: 10, minute: 30 }
  ]);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /- cron: "30 14 \* \* 1"/);
  assert.match(workflow, /- cron: "30 15 \* \* 1"/);
  assert.doesNotMatch(workflow, /1-5/);
  assert.match(workflow, /\[ "\$SCHEDULE" = "30 14 \* \* 1" \] && \[ "\$LOCAL_ZONE" = "PDT" \]/);
  assert.match(workflow, /\[ "\$SCHEDULE" = "30 15 \* \* 1" \] && \[ "\$LOCAL_ZONE" = "PST" \]/);
});

test("stale dashboard waits successfully without generating a PDF", async () => {
  const fixture = await createSyncFixture("August 9, 2026");
  const result = runLocalSync({ env: syncEnvironment(fixture) });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Weekly Market Pressure Gauge has not published today's report yet\./);
  assert.match(result.stdout, /Expected: 2026-08-10/);
  assert.match(result.stdout, /Found: 2026-08-09/);
  assert.deepEqual(await readLocalStatus(fixture), {
    lastAttempt: "2026-08-10T15:30:01-07:00",
    expectedDate: "2026-08-10",
    dashboardDate: "2026-08-09",
    status: "waiting_for_dashboard",
    pdf: "2026-08-10.pdf"
  });
  assert.equal(spawnSync("test", ["-e", path.join(fixture.driveDir, "2026-08-10.pdf")]).status, 1);
});

test("current dashboard generates a PDF and writes success status", async () => {
  const fixture = await createSyncFixture("August 10, 2026");
  const result = runLocalSync({ env: syncEnvironment(fixture) });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Weekly Market Pressure Gauge archived successfully/);
  assert.equal(spawnSync("test", ["-s", path.join(fixture.driveDir, "2026-08-10.pdf")]).status, 0);
  assert.equal((await readLocalStatus(fixture)).status, "success");
});

test("valid same-day PDF exits successfully without regenerating", async () => {
  const fixture = await createSyncFixture("August 10, 2026");
  const first = runLocalSync({ env: syncEnvironment(fixture) });
  assert.equal(first.status, 0, first.stderr);

  const second = runLocalSync({
    env: syncEnvironment(fixture, "2026-08-10T16:30:01-07:00")
  });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /Today's PDF already exists\. Nothing to do\./);
  assert.deepEqual(await readLocalStatus(fixture), {
    lastAttempt: "2026-08-10T16:30:01-07:00",
    expectedDate: "2026-08-10",
    dashboardDate: "2026-08-10",
    status: "already_archived",
    pdf: "2026-08-10.pdf"
  });
});

test("a later retry archives the PDF after an earlier stale attempt", async () => {
  const fixture = await createSyncFixture("August 9, 2026");
  const waiting = runLocalSync({ env: syncEnvironment(fixture, "2026-08-10T14:30:01-07:00") });
  assert.equal(waiting.status, 0, waiting.stderr);

  await writeFile(path.join(fixture.root, "data.json"), JSON.stringify({ date: "August 10, 2026" }));
  const success = runLocalSync({ env: syncEnvironment(fixture, "2026-08-10T15:30:01-07:00") });
  assert.equal(success.status, 0, success.stderr);
  assert.equal((await readLocalStatus(fixture)).status, "success");

  const attempts = await readFile(path.join(fixture.root, "logs", "local-sync-pdf.runs.log"), "utf8");
  assert.match(attempts, /result=waiting_for_dashboard/);
  assert.match(attempts, /result=success/);
});

test("one Google Drive account is detected and configured", async () => {
  const root = await tempDir();
  const cloudRoot = path.join(root, "CloudStorage");
  const driveRoot = path.join(cloudRoot, "GoogleDrive-user@example.com", "My Drive");
  await mkdir(driveRoot, { recursive: true });

  const result = runFunction(`initialize_local_config ${shellQuote(root)}`, {
    env: { KCI_CLOUD_STORAGE_ROOT: cloudRoot }
  });

  assert.equal(result.status, 0, result.stderr);
  const envFile = await readFile(path.join(root, ".local-dashboard.env"), "utf8");
  assert.match(envFile, /GOOGLE_DRIVE_PDF_DIR=.*KCI\/PDFs/);
  assert.match(envFile, /GOOGLE_DRIVE_JSON_DIR=.*KCI\/JSON/);
  assert.match(envFile, /GOOGLE_DRIVE_MONTHLY_DIR=.*KCI\/Monthly/);
});

test("multiple Google Drive accounts can be selected", async () => {
  const root = await tempDir();
  const cloudRoot = path.join(root, "CloudStorage");
  const first = path.join(cloudRoot, "GoogleDrive-a@example.com");
  const second = path.join(cloudRoot, "GoogleDrive-b@example.com");
  await mkdir(first, { recursive: true });
  await mkdir(second, { recursive: true });

  const result = runFunction("select_google_drive_root", {
    env: {
      KCI_CLOUD_STORAGE_ROOT: cloudRoot,
      KCI_GOOGLE_DRIVE_SELECTION: "2"
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), second);
  assert.match(result.stderr, /Multiple Google Drive accounts were found/);
});

test("no Google Drive install fails clearly", async () => {
  const root = await tempDir();
  const cloudRoot = path.join(root, "CloudStorage");
  await mkdir(cloudRoot);

  const result = runFunction("select_google_drive_root", {
    env: { KCI_CLOUD_STORAGE_ROOT: cloudRoot }
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Google Drive for Desktop was not found/);
});


test("non-Monday manual run records no_report_expected without generating a PDF", async () => {
  const fixture = await createSyncFixture("August 10, 2026");
  const result = runLocalSync({ env: { ...syncEnvironment(fixture), KCI_SYNC_TEST_WEEKDAY: "2" } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /No weekly report is expected today/);
  assert.deepEqual(await readLocalStatus(fixture), {
    lastAttempt: "2026-08-10T15:30:01-07:00",
    expectedDate: "2026-08-10",
    dashboardDate: "not_applicable",
    status: "no_report_expected",
    pdf: null
  });
  assert.equal(spawnSync("test", ["-e", path.join(fixture.driveDir, "2026-08-10.pdf")]).status, 1);
});


test("local Chrome runs with an isolated profile and installer reloads the LaunchAgent", async () => {
  const [script, installer] = await Promise.all([
    readFile(scriptPath, "utf8"),
    readFile(installerPath, "utf8")
  ]);
  assert.match(script, /--user-data-dir="\$tmp_dir\/chrome-profile"/);
  assert.match(installer, /launchctl bootstrap/);
  assert.match(installer, /launchctl load/);
});
