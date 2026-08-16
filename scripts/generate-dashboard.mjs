#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import OpenAI from "openai";

const REQUIRED_TOP_LEVEL_FIELDS = [
  "title",
  "date",
  "composite",
  "stressDrivers",
  "sparklines",
  "trafficLights",
  "whatBreaksFirst",
  "opportunity",
  "trends",
  "regimeTracker",
  "actions",
  "insiderActivity",
  "takeaway",
  "disclosure"
];

const TRAFFIC_STATUSES = new Set(["green", "yellow", "orange", "red"]);
const TRAFFIC_TRENDS = new Set(["up", "down", "flat"]);
const SHOCK_TERMS = [
  "major shock",
  "market shock",
  "crash",
  "bank failure",
  "default wave",
  "sovereign crisis",
  "systemic event",
  "liquidity freeze",
  "credit event",
  "market dislocation"
];
const SLOW_MOVING_LABELS = new Set([
  "Private Credit Defaults (%)",
  "Card Delinquencies (%)",
  "Private Credit Stress",
  "Consumer Credit Stress"
]);

function parseArgs(argv) {
  const args = {
    root: process.env.DASHBOARD_ROOT || process.cwd(),
    mockOutput: process.env.DASHBOARD_MOCK_RESPONSE_PATH || "",
    reportDate: process.env.REPORT_DATE || "",
    validateCurrent: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i];
    else if (arg === "--mock-output") args.mockOutput = argv[++i];
    else if (arg === "--report-date") args.reportDate = argv[++i];
    else if (arg === "--validate-current") args.validateCurrent = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function getReportDate(input = "") {
  const date = input ? new Date(`${input}T12:00:00-07:00`) : new Date();
  if (Number.isNaN(date.valueOf())) {
    throw new Error(`Invalid report date: ${input}`);
  }

  const iso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);

  const display = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(date);

  return { iso, display };
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function normalizeDashboardForSchema(dashboard) {
  const normalized = structuredClone(dashboard);

  if (Array.isArray(normalized.trends?.headline)) {
    normalized.trends.headline = normalized.trends.headline.map((row) => ({
      label: row.label,
      d90: row.d90,
      d30: row.d30,
      today: row.today,
      goodWhenUp: row.label === "Opportunity"
    }));
  }

  return normalized;
}

export function inferSchema(value) {
  if (Array.isArray(value)) {
    return {
      type: "array",
      items: value.length > 0 ? inferSchema(value[0]) : {}
    };
  }

  if (value && typeof value === "object") {
    const properties = {};
    for (const [key, child] of Object.entries(value)) {
      properties[key] = inferSchema(child);
    }
    return {
      type: "object",
      additionalProperties: false,
      properties,
      required: Object.keys(value)
    };
  }

  if (typeof value === "number") return { type: "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  return { type: "string" };
}

function promptForDashboard(prior, reportDate) {
  return [
    {
      role: "system",
      content:
        "You are a careful market research analyst producing a weekly Market Pressure Gauge data file. Use web search to verify current market pressure and bubble-risk signals. Return only JSON that matches the provided schema. Do not include markdown, citations, comments, or explanatory text outside the JSON object."
    },
    {
      role: "user",
      content: [
        `Report date: ${reportDate.display} (${reportDate.iso}).`,
        "Use the prior dashboard JSON below as the baseline and preserve its exact object shape.",
        "Preserve every required top-level field, all 20 traffic-light categories, actions.doNowLabel, actions.doNotYetLabel, the full disclosure language, and the insiderActivity sector structure.",
        "Do not change composite.stressScore by more than 0.2 in one day unless current research explicitly identifies a major shock; if that happens, name the shock plainly in the dashboard text.",
        "Do not invent weekly insider-activity numbers. Carry them forward unless a current reliable source verifies a new weekly data set; update insiderActivity.asOf only when verified.",
        "Preserve slow-moving private-credit and consumer-credit figures until a new release is found.",
        "Ensure whatBreaksFirst probabilities total exactly 100.",
        "Ensure score-like fields are within 0-10.",
        "Allowed traffic-light status values: green, yellow, orange, red.",
        "Allowed traffic-light trend values: up, down, flat.",
        "Prior dashboard JSON:",
        JSON.stringify(prior, null, 2)
      ].join("\n\n")
    }
  ];
}

async function generateWithOpenAI(prior, schema, reportDate) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required unless --mock-output is used.");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || "gpt-5",
    tools: [
      {
        type: "web_search",
        search_context_size: "high",
        user_location: {
          type: "approximate",
          country: "US",
          region: "California",
          timezone: "America/Los_Angeles"
        }
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "weekly_market_pressure_gauge",
        strict: true,
        schema
      }
    },
    input: promptForDashboard(prior, reportDate)
  });

  return response.output_text;
}

function parseModelJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Model output was not valid JSON: ${error.message}`);
  }
}

function sameKeys(actual, expected, label) {
  const actualKeys = Object.keys(actual);
  const expectedKeys = Object.keys(expected);
  if (actualKeys.length !== expectedKeys.length) {
    throw new Error(`${label} keys changed.`);
  }
  for (let i = 0; i < expectedKeys.length; i += 1) {
    if (actualKeys[i] !== expectedKeys[i]) {
      throw new Error(`${label} key order changed at index ${i}: expected ${expectedKeys[i]}, got ${actualKeys[i]}`);
    }
  }
}

function assertNumberInRange(value, label, min = 0, max = 10) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be a finite number from ${min} to ${max}.`);
  }
}

function validateShape(candidate, prior, label = "dashboard") {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`${label} must be a JSON object.`);
  }

  sameKeys(candidate, Object.fromEntries(REQUIRED_TOP_LEVEL_FIELDS.map((field) => [field, true])), "Top-level");
  for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
    if (!(field in candidate)) throw new Error(`Missing required top-level field: ${field}`);
  }

  sameKeys(candidate.composite, prior.composite, "composite");
  sameKeys(candidate.sparklines, prior.sparklines, "sparklines");
  sameKeys(candidate.opportunity, prior.opportunity, "opportunity");
  sameKeys(candidate.trends, prior.trends, "trends");
  sameKeys(candidate.regimeTracker, prior.regimeTracker, "regimeTracker");
  sameKeys(candidate.actions, prior.actions, "actions");
  sameKeys(candidate.insiderActivity, prior.insiderActivity, "insiderActivity");
}

function validateTrafficLights(candidate, prior) {
  if (!Array.isArray(candidate.trafficLights) || candidate.trafficLights.length !== 20) {
    throw new Error("trafficLights must contain exactly 20 categories.");
  }

  candidate.trafficLights.forEach((light, index) => {
    const priorLight = prior.trafficLights[index];
    sameKeys(light, priorLight, `trafficLights[${index}]`);
    if (light.label !== priorLight.label) {
      throw new Error(`trafficLights[${index}] label changed: expected ${priorLight.label}, got ${light.label}`);
    }
    if (!TRAFFIC_STATUSES.has(light.status)) {
      throw new Error(`Invalid traffic-light status for ${light.label}: ${light.status}`);
    }
    if (!TRAFFIC_TRENDS.has(light.trend)) {
      throw new Error(`Invalid traffic-light trend for ${light.label}: ${light.trend}`);
    }
  });
}

function validateWhatBreaksFirst(candidate, prior) {
  if (!Array.isArray(candidate.whatBreaksFirst) || candidate.whatBreaksFirst.length !== prior.whatBreaksFirst.length) {
    throw new Error("whatBreaksFirst category count changed.");
  }

  let total = 0;
  candidate.whatBreaksFirst.forEach((item, index) => {
    sameKeys(item, prior.whatBreaksFirst[index], `whatBreaksFirst[${index}]`);
    if (item.label !== prior.whatBreaksFirst[index].label) {
      throw new Error(`whatBreaksFirst[${index}] label changed.`);
    }
    if (!Number.isInteger(item.probability) || item.probability < 0 || item.probability > 100) {
      throw new Error(`Invalid whatBreaksFirst probability for ${item.label}.`);
    }
    total += item.probability;
  });

  if (total !== 100) {
    throw new Error(`whatBreaksFirst probabilities must total 100; got ${total}.`);
  }
}

function validateScoreFields(candidate) {
  assertNumberInRange(candidate.composite.stressScore, "composite.stressScore");
  assertNumberInRange(candidate.composite.opportunityScore, "composite.opportunityScore");

  candidate.stressDrivers.forEach((driver, index) => {
    assertNumberInRange(driver.value, `stressDrivers[${index}].value`);
  });

  candidate.opportunity.forcedSelling.forEach((item, index) => {
    assertNumberInRange(item.score, `opportunity.forcedSelling[${index}].score`);
  });

  for (const [key, value] of Object.entries(candidate.opportunity.buffettMeter)) {
    assertNumberInRange(value, `opportunity.buffettMeter.${key}`);
  }
}

function allDashboardText(candidate) {
  return [
    candidate.composite.regime,
    candidate.composite.regimeTrend,
    candidate.composite.stance,
    candidate.composite.stanceNote,
    candidate.regimeTracker.direction,
    candidate.takeaway,
    ...candidate.actions.doNow,
    ...candidate.actions.doNotYet
  ].join(" ").toLowerCase();
}

function validateCompositeMove(candidate, prior) {
  const delta = Math.abs(candidate.composite.stressScore - prior.composite.stressScore);
  if (delta <= 0.2 + Number.EPSILON) return;

  const text = allDashboardText(candidate);
  const hasShockRationale = SHOCK_TERMS.some((term) => text.includes(term));
  if (!hasShockRationale) {
    throw new Error(`composite.stressScore changed by ${delta.toFixed(1)} without an explicit major-shock rationale.`);
  }
}

function validatePreservedText(candidate, prior) {
  if (candidate.actions.doNowLabel !== prior.actions.doNowLabel) {
    throw new Error("actions.doNowLabel must be preserved.");
  }
  if (candidate.actions.doNotYetLabel !== prior.actions.doNotYetLabel) {
    throw new Error("actions.doNotYetLabel must be preserved.");
  }
  if (candidate.disclosure !== prior.disclosure) {
    throw new Error("disclosure language must be preserved exactly.");
  }
}

function validateInsiderActivity(candidate, prior) {
  sameKeys(candidate.insiderActivity.thresholds, prior.insiderActivity.thresholds, "insiderActivity.thresholds");
  if (!Array.isArray(candidate.insiderActivity.sectors) || candidate.insiderActivity.sectors.length !== prior.insiderActivity.sectors.length) {
    throw new Error("insiderActivity sector structure changed.");
  }

  let changedNumbers = false;
  candidate.insiderActivity.sectors.forEach((sector, index) => {
    const priorSector = prior.insiderActivity.sectors[index];
    sameKeys(sector, priorSector, `insiderActivity.sectors[${index}]`);
    if (sector.label !== priorSector.label) {
      throw new Error(`insiderActivity.sectors[${index}] label changed.`);
    }
    if (!Number.isFinite(sector.buying) || !Number.isFinite(sector.selling)) {
      throw new Error(`Insider values for ${sector.label} must be numeric.`);
    }
    if (sector.buying !== priorSector.buying || sector.selling !== priorSector.selling) {
      changedNumbers = true;
    }
  });

  if (changedNumbers && candidate.insiderActivity.asOf === prior.insiderActivity.asOf) {
    throw new Error("Insider numbers changed without updating insiderActivity.asOf.");
  }
  if (changedNumbers && /latest reported week/i.test(candidate.insiderActivity.asOf)) {
    throw new Error("Insider numbers changed but insiderActivity.asOf is not a verified date or week.");
  }
}

function validateSlowMovingCredit(candidate, prior) {
  const text = allDashboardText(candidate);
  const mentionsNewRelease = /\b(new|latest|updated)\s+(release|data|report)\b/i.test(text);
  const priorRows = [...prior.trends.headline, ...prior.trends.credit];
  const candidateRows = [...candidate.trends.headline, ...candidate.trends.credit];

  candidateRows.forEach((row, index) => {
    const priorRow = priorRows[index];
    if (!SLOW_MOVING_LABELS.has(row.label)) return;
    const changed = row.d90 !== priorRow.d90 || row.d30 !== priorRow.d30 || row.today !== priorRow.today;
    if (changed && !mentionsNewRelease) {
      throw new Error(`${row.label} changed without mentioning a new data release.`);
    }
  });
}

function validateComparableArrays(candidate, prior) {
  const preserveLabels = (candidateArray, priorArray, label) => {
    if (!Array.isArray(candidateArray) || candidateArray.length !== priorArray.length) {
      throw new Error(`${label} length changed.`);
    }
    candidateArray.forEach((item, index) => {
      sameKeys(item, priorArray[index], `${label}[${index}]`);
      if (item.label !== priorArray[index].label) {
        throw new Error(`${label}[${index}] label changed.`);
      }
    });
  };

  preserveLabels(candidate.stressDrivers, prior.stressDrivers, "stressDrivers");
  preserveLabels(candidate.opportunity.forcedSelling, prior.opportunity.forcedSelling, "opportunity.forcedSelling");
  preserveLabels(candidate.trends.headline, prior.trends.headline, "trends.headline");
  preserveLabels(candidate.trends.rates, prior.trends.rates, "trends.rates");
  preserveLabels(candidate.trends.credit, prior.trends.credit, "trends.credit");
  preserveLabels(candidate.trends.speculation, prior.trends.speculation, "trends.speculation");
  preserveLabels(candidate.regimeTracker.signals, prior.regimeTracker.signals, "regimeTracker.signals");
}

function validateDashboard(candidate, prior, reportDate, options = {}) {
  validateShape(candidate, prior, options.label || "dashboard");
  if (!options.skipDateCheck && candidate.date !== reportDate.display) {
    throw new Error(`dashboard date must be ${reportDate.display}; got ${candidate.date}`);
  }
  validateComparableArrays(candidate, prior);
  validateTrafficLights(candidate, prior);
  validateWhatBreaksFirst(candidate, prior);
  validateScoreFields(candidate);
  validateCompositeMove(candidate, prior);
  validatePreservedText(candidate, prior);
  validateInsiderActivity(candidate, prior);
  validateSlowMovingCredit(candidate, prior);
}

async function updateHistory(root, dateIso, dashboard) {
  const historyDir = path.join(root, "history");
  const indexPath = path.join(historyDir, "index.json");
  await fs.mkdir(historyDir, { recursive: true });
  await fs.writeFile(path.join(historyDir, `${dateIso}.json`), stableJson(dashboard));

  let dates = [];
  try {
    const existing = await readJson(indexPath);
    if (!Array.isArray(existing)) throw new Error("history/index.json must be an array of dates.");
    dates = existing;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  dates = Array.from(new Set([dateIso, ...dates])).sort((a, b) => b.localeCompare(a));
  await fs.writeFile(indexPath, stableJson(dates));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(args.root);
  const dataPath = path.join(root, "data.json");
  const prior = normalizeDashboardForSchema(await readJson(dataPath));
  const reportDate = getReportDate(args.reportDate);

  if (args.validateCurrent) {
    validateDashboard(prior, prior, reportDate, { skipDateCheck: true, label: "current data.json" });
    console.log(`Validated data.json: ${prior.date}, stress score ${prior.composite.stressScore}`);
    return;
  }

  const schema = inferSchema(prior);
  const raw = args.mockOutput
    ? await fs.readFile(path.resolve(args.mockOutput), "utf8")
    : await generateWithOpenAI(prior, schema, reportDate);
  const candidate = parseModelJson(raw);
  candidate.date = reportDate.display;

  validateDashboard(candidate, prior, reportDate);

  await fs.writeFile(dataPath, stableJson(candidate));
  await updateHistory(root, reportDate.iso, candidate);

  console.log(`Published dashboard ${reportDate.iso}: stress score ${candidate.composite.stressScore}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`Dashboard generation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
