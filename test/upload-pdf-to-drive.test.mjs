import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildDriveSearchQuery,
  chooseExistingDriveFile,
  driveFileNameFromPdfPath,
  parseServiceAccountJson,
  uploadOrReplacePdf
} from "../scripts/upload-pdf-to-drive.mjs";

async function tempPdf() {
  const root = await mkdtemp(path.join(os.tmpdir(), "kci-drive-test-"));
  const pdfPath = path.join(root, "market-pressure-gauge-2026-08-04.pdf");
  await writeFile(pdfPath, "pdf content");
  return pdfPath;
}

test("Drive upload filename normalizes to YYYY-MM-DD.pdf", () => {
  assert.equal(
    driveFileNameFromPdfPath("artifacts/market-pressure-gauge-2026-08-04.pdf"),
    "2026-08-04.pdf"
  );
});

test("Drive search query targets duplicate filename in folder", () => {
  assert.equal(
    buildDriveSearchQuery("folder123", "2026-08-04.pdf"),
    "'folder123' in parents and name = '2026-08-04.pdf' and trashed = false"
  );
});

test("duplicate Drive filename replacement uses files.update", async () => {
  const pdfPath = await tempPdf();
  const calls = [];
  const drive = {
    files: {
      list: async () => ({ data: { files: [{ id: "existing-id", name: "2026-08-04.pdf" }] } }),
      update: async (args) => {
        calls.push(["update", args.fileId, args.requestBody.name]);
        return { data: { id: args.fileId, name: args.requestBody.name, size: "12345" } };
      },
      create: async () => {
        calls.push(["create"]);
        throw new Error("create should not be called for duplicates");
      }
    }
  };

  const uploaded = await uploadOrReplacePdf({
    drive,
    pdfPath,
    folderId: "folder123",
    fileName: "2026-08-04.pdf"
  });

  assert.equal(uploaded.id, "existing-id");
  assert.deepEqual(calls, [["update", "existing-id", "2026-08-04.pdf"]]);
});

test("chooseExistingDriveFile returns the first duplicate candidate", () => {
  assert.deepEqual(
    chooseExistingDriveFile([{ id: "first" }, { id: "second" }]),
    { id: "first" }
  );
});

test("malformed service account JSON is rejected", () => {
  assert.throws(
    () => parseServiceAccountJson("{ malformed"),
    /GOOGLE_SERVICE_ACCOUNT_JSON is malformed JSON/
  );
});
