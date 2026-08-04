#!/usr/bin/env node
import process from "node:process";
import { validatePdfFile } from "./dashboard-run-utils.mjs";

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) throw new Error("Usage: node scripts/validate-pdf.mjs <pdf-path>");
  const result = await validatePdfFile(pdfPath);
  console.log(`Validated PDF ${result.path} (${result.size} bytes).`);
}

main().catch((error) => {
  console.error(`::error::${error.message}`);
  process.exitCode = 1;
});
