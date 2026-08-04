#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { buildHeartbeat, writeJson } from "./dashboard-run-utils.mjs";

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? "" : process.argv[index + 1];
}

async function main() {
  const heartbeat = buildHeartbeat({
    reportDate: arg("report-date"),
    stressScore: Number(arg("stress-score")),
    opportunityScore: Number(arg("opportunity-score")),
    commit: arg("commit"),
    historyFile: arg("history-file"),
    pdfFile: arg("pdf-file"),
    driveUploadStatus: arg("drive-upload-status") || "success"
  });

  await writeJson(path.join(process.cwd(), "heartbeat.json"), heartbeat);
  console.log("heartbeat.json status: success");
}

main().catch((error) => {
  console.error(`::error::${error.message}`);
  process.exitCode = 1;
});
