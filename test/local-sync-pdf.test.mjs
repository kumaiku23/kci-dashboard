import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
  const result = runFunction(`load_local_config ${shellQuote(root)}`);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing .*\.local-dashboard\.env/);
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
