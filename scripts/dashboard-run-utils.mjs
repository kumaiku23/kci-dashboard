import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export function getLosAngelesReportDate(now = new Date()) {
  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);

  const display = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(now);

  const timestamp = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(now).replace(" ", "T");

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    timeZoneName: "longOffset"
  }).formatToParts(now);
  const offset = parts.find((part) => part.type === "timeZoneName")?.value.replace("GMT", "") || "-08:00";

  return { iso, display, timestamp: `${timestamp}${offset}` };
}

export function getWeekOfDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short"
  }).formatToParts(now);
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const localDate = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(values.weekday);
  localDate.setUTCDate(localDate.getUTCDate() - ((weekday + 6) % 7));
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(localDate);
}

export async function readJson(filePath) {
  return JSON.parse(await fsp.readFile(filePath, "utf8"));
}

export async function writeJson(filePath, value) {
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function validateDashboardFreshness(root = process.cwd(), now = new Date()) {
  const reportDate = getLosAngelesReportDate(now);
  const dataPath = path.join(root, "data.json");
  const dashboard = await readJson(dataPath);

  if (dashboard.date !== reportDate.display) {
    throw new Error(`Dashboard is stale. Expected ${reportDate.display} but found ${dashboard.date}.`);
  }

  const historyFile = `history/${reportDate.iso}.json`;
  const historyPath = path.join(root, historyFile);
  if (!fs.existsSync(historyPath)) {
    throw new Error(`Dashboard history file is missing. Expected ${historyFile}.`);
  }

  const index = await readJson(path.join(root, "history/index.json"));
  if (!Array.isArray(index) || index[0] !== reportDate.iso) {
    throw new Error(`Dashboard history index is stale. Expected first entry ${reportDate.iso} but found ${Array.isArray(index) ? index[0] : "non-array index"}.`);
  }

  return {
    isoDate: reportDate.iso,
    displayDate: reportDate.display,
    weekOfDate: getWeekOfDate(now),
    historyFile,
    stressScore: dashboard.composite.stressScore,
    opportunityScore: dashboard.composite.opportunityScore
  };
}

export async function validatePdfFile(pdfPath, minBytes = 10 * 1024) {
  let stats;
  try {
    stats = await fsp.stat(pdfPath);
  } catch {
    throw new Error(`PDF was not generated: ${pdfPath}`);
  }

  if (!stats.isFile()) {
    throw new Error(`PDF path is not a file: ${pdfPath}`);
  }

  if (stats.size <= minBytes) {
    throw new Error(`PDF is too small: ${pdfPath} is ${stats.size} bytes, expected more than ${minBytes} bytes.`);
  }

  return { path: pdfPath, size: stats.size };
}

export function buildHeartbeat({
  now = new Date(),
  reportDate,
  stressScore,
  opportunityScore,
  commit,
  historyFile,
  pdfFile,
  driveUploadStatus = "success"
}) {
  return {
    lastRun: getLosAngelesReportDate(now).timestamp,
    status: "success",
    reportDate,
    stressScore,
    opportunityScore,
    commit,
    historyFile,
    pdfFile,
    driveUploadStatus
  };
}
