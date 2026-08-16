#!/usr/bin/env node
import process from "node:process";
import { validateDashboardFreshness } from "./dashboard-run-utils.mjs";

async function main() {
  const result = await validateDashboardFreshness(process.cwd());
  if (process.env.GITHUB_OUTPUT) {
    const fs = await import("node:fs");
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `iso_date=${result.isoDate}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `history_file=${result.historyFile}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `report_date=${result.displayDate}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `week_of_date=${result.weekOfDate}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `stress_score=${result.stressScore}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `opportunity_score=${result.opportunityScore}\n`);
  }
  console.log(`Weekly Market Pressure Gauge watchdog passed for ${result.displayDate}.`);
}

main().catch((error) => {
  console.error(`::error::${error.message}`);
  process.exitCode = 1;
});
