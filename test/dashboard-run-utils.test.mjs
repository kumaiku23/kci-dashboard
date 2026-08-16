import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildHeartbeat,
  getWeekOfDate,
  validateDashboardFreshness,
  validatePdfFile,
  writeJson
} from "../scripts/dashboard-run-utils.mjs";

const AUG_4_2026 = new Date("2026-08-04T20:00:00Z");

async function tempRoot() {
  return mkdtemp(path.join(os.tmpdir(), "kci-dashboard-test-"));
}

async function writeDashboardRoot(root, { date = "August 4, 2026", index = ["2026-08-04"] } = {}) {
  await mkdir(path.join(root, "history"), { recursive: true });
  await writeJson(path.join(root, "data.json"), {
    date,
    composite: {
      stressScore: 8,
      opportunityScore: 8.8
    }
  });
  await writeJson(path.join(root, "history/2026-08-04.json"), { date });
  await writeJson(path.join(root, "history/index.json"), index);
}

test("stale dashboard date is rejected", async () => {
  const root = await tempRoot();
  await writeDashboardRoot(root, { date: "August 3, 2026" });

  await assert.rejects(
    () => validateDashboardFreshness(root, AUG_4_2026),
    /Dashboard is stale\. Expected August 4, 2026 but found August 3, 2026\./
  );
});

test("history index must start with today's ISO date", async () => {
  const root = await tempRoot();
  await writeDashboardRoot(root, { index: ["2026-08-03", "2026-08-04"] });

  await assert.rejects(
    () => validateDashboardFreshness(root, AUG_4_2026),
    /Expected first entry 2026-08-04 but found 2026-08-03/
  );
});

test("heartbeat schema contains successful run fields", () => {
  const heartbeat = buildHeartbeat({
    now: AUG_4_2026,
    reportDate: "August 4, 2026",
    stressScore: 8,
    opportunityScore: 8.8,
    commit: "abc123",
    historyFile: "history/2026-08-04.json",
    pdfFile: "market-pressure-gauge-2026-08-04.pdf",
    driveUploadStatus: "success"
  });

  assert.deepEqual(Object.keys(heartbeat), [
    "lastRun",
    "status",
    "reportDate",
    "stressScore",
    "opportunityScore",
    "commit",
    "historyFile",
    "pdfFile",
    "driveUploadStatus"
  ]);
  assert.equal(heartbeat.status, "success");
  assert.equal(heartbeat.reportDate, "August 4, 2026");
  assert.equal(heartbeat.driveUploadStatus, "success");
});

test("missing PDF is rejected", async () => {
  await assert.rejects(
    () => validatePdfFile(path.join(os.tmpdir(), "missing-dashboard.pdf")),
    /PDF was not generated/
  );
});

test("undersized PDF is rejected", async () => {
  const root = await tempRoot();
  const pdfPath = path.join(root, "small.pdf");
  await writeFile(pdfPath, "tiny");

  await assert.rejects(
    () => validatePdfFile(pdfPath),
    /PDF is too small/
  );
});


test("week-of date resolves to the Los Angeles Monday across boundaries", () => {
  assert.equal(getWeekOfDate(new Date("2026-08-17T19:00:00Z")), "August 17, 2026");
  assert.equal(getWeekOfDate(new Date("2026-08-19T19:00:00Z")), "August 17, 2026");
  assert.equal(getWeekOfDate(new Date("2026-08-23T19:00:00Z")), "August 17, 2026");
  assert.equal(getWeekOfDate(new Date("2027-01-01T20:00:00Z")), "December 28, 2026");
  assert.equal(getWeekOfDate(new Date("2026-03-09T19:00:00Z")), "March 9, 2026");
});
