import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const scriptPath = path.resolve("scripts/local-sync-pdf.sh");

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

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), "kci-local-sync-test-"));
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
