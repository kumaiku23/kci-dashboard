import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const indexPath = new URL("../index.html", import.meta.url);
const workflowPath = new URL("../.github/workflows/daily-dashboard.yml", import.meta.url);

async function readFixture(path) {
  return readFile(path, "utf8");
}

test("PDF control is a date-specific anchor, not a print button", async () => {
  const index = await readFixture(indexPath);

  assert.match(index, /<a id="pdf-download" class="pdf-button" href="\.\/latest\.pdf" target="_blank" rel="noopener">⤓ Save PDF<\/a>/);
  assert.doesNotMatch(index, /<button onclick="window\.print\(\)">⤓ Save as PDF<\/button>/);
  assert.match(index, /link\.href = `\.\/reports\/\$\{isoDate\}\.pdf`/);
});

test("Pages deploy downloads and publishes the generated PDF", async () => {
  const workflow = await readFixture(workflowPath);

  assert.match(workflow, /uses: actions\/download-artifact@v8\.0\.1/);
  assert.match(workflow, /name: market-stress-dashboard-\$\{\{ needs\.publish\.outputs\.iso_date \}\}/);
  assert.match(workflow, /PDF_SOURCE="workflow-artifact\/\$\{PDF_FILE\}"/);
  assert.match(workflow, /test -f "\$PDF_SOURCE"/);
  assert.match(workflow, /\[ "\$PDF_SIZE" -le 10240 \]/);
  assert.match(workflow, /cp "\$PDF_SOURCE" _site\/latest\.pdf/);
  assert.match(workflow, /cp "\$PDF_SOURCE" "_site\/reports\/\$\{EXPECTED_ISO_DATE\}\.pdf"/);
  assert.match(workflow, /test -f _site\/latest\.pdf/);
  assert.match(workflow, /test -f "_site\/reports\/\$\{EXPECTED_ISO_DATE\}\.pdf"/);
});

test("live Pages verification requires today's PDF to be public and nontrivial", async () => {
  const workflow = await readFixture(workflowPath);

  assert.match(workflow, /https:\/\/kumaiku23\.github\.io\/kci-dashboard\/reports\/\$\{EXPECTED_ISO_DATE\}\.pdf/);
  assert.match(workflow, /--output "\$LIVE_PDF"/);
  assert.match(workflow, /--write-out '%\{http_code\} %\{size_download\}'/);
  assert.match(workflow, /\[ "\$live_pdf_status" = "200" \]/);
  assert.match(workflow, /\[ "\$\{live_pdf_size%\.\*\}" -gt 10240 \]/);
});
