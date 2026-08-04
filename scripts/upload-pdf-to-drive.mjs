#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { google } from "googleapis";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

export function parseServiceAccountJson(raw) {
  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch (error) {
    throw new Error(`GOOGLE_SERVICE_ACCOUNT_JSON is malformed JSON: ${error.message}`);
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON must include client_email and private_key.");
  }

  return credentials;
}

export function driveFileNameFromPdfPath(pdfPath) {
  const base = path.basename(pdfPath);
  const match = base.match(/(\d{4}-\d{2}-\d{2})\.pdf$/);
  if (!match) {
    throw new Error(`PDF filename must end with YYYY-MM-DD.pdf: ${base}`);
  }
  return `${match[1]}.pdf`;
}

function escapeDriveQueryValue(value) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function buildDriveSearchQuery(folderId, fileName) {
  return `'${escapeDriveQueryValue(folderId)}' in parents and name = '${escapeDriveQueryValue(fileName)}' and trashed = false`;
}

export function chooseExistingDriveFile(files = []) {
  return files.length > 0 ? files[0] : null;
}

export async function findExistingDriveFile(drive, folderId, fileName) {
  const response = await drive.files.list({
    q: buildDriveSearchQuery(folderId, fileName),
    fields: "files(id,name,size)",
    spaces: "drive",
    pageSize: 10
  });
  return chooseExistingDriveFile(response.data.files || []);
}

export async function uploadOrReplacePdf({ drive, pdfPath, folderId, fileName }) {
  const requestBody = { name: fileName, mimeType: "application/pdf" };
  const media = { mimeType: "application/pdf", body: fs.createReadStream(pdfPath) };
  const existing = await findExistingDriveFile(drive, folderId, fileName);

  if (existing) {
    const response = await drive.files.update({
      fileId: existing.id,
      requestBody,
      media,
      fields: "id,name,size"
    });
    return response.data;
  }

  const response = await drive.files.create({
    requestBody: {
      ...requestBody,
      parents: [folderId]
    },
    media,
    fields: "id,name,size"
  });
  return response.data;
}

export async function verifyDriveFile(drive, fileId) {
  const response = await drive.files.get({
    fileId,
    fields: "id,name,size"
  });
  const file = response.data;
  if (!file.id || Number(file.size || 0) <= 0) {
    throw new Error(`Uploaded Google Drive file ${fileId} is missing or has zero size.`);
  }
  return file;
}

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) throw new Error("Usage: node scripts/upload-pdf-to-drive.mjs <pdf-path>");

  const stats = await fsp.stat(pdfPath);
  if (!stats.isFile() || stats.size <= 0) {
    throw new Error(`PDF path is missing or empty: ${pdfPath}`);
  }

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is required.");
  }
  if (!process.env.GOOGLE_DRIVE_FOLDER_ID) {
    throw new Error("GOOGLE_DRIVE_FOLDER_ID is required.");
  }

  const credentials = parseServiceAccountJson(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [DRIVE_SCOPE]
  });
  const drive = google.drive({ version: "v3", auth });
  const fileName = driveFileNameFromPdfPath(pdfPath);
  const uploaded = await uploadOrReplacePdf({
    drive,
    pdfPath,
    folderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
    fileName
  });
  const verified = await verifyDriveFile(drive, uploaded.id);

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `drive_file_id=${verified.id}\n`);
    fs.appendFileSync(process.env.GITHUB_OUTPUT, "drive_upload_status=success\n");
  }
  console.log(`Uploaded Google Drive file ID: ${verified.id}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  });
}
