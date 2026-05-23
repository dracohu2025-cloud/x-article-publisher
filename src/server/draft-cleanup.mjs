import fs from "node:fs/promises";
import path from "node:path";

const IMPORTED_MARKER = ".xap-imported.json";
const ASSETS_DIR = "assets";

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function resolveDraftDir(draftsRoot, rawDraftPath) {
  if (!rawDraftPath) {
    throw new Error("缺少草稿路径");
  }

  const root = path.resolve(draftsRoot);
  const draftPath = path.resolve(rawDraftPath);
  if (!isInside(root, draftPath) || path.basename(draftPath) !== "draft.json") {
    throw new Error("只允许标记 .xap/drafts 下的 draft.json");
  }
  return path.dirname(draftPath);
}

export async function markDraftImported({
  draftsRoot,
  draftPath,
  importedAt = new Date(),
  summary = {},
}) {
  const draftDir = resolveDraftDir(draftsRoot, draftPath);
  const markerPath = path.join(draftDir, IMPORTED_MARKER);
  const metadata = {
    importedAt: importedAt.toISOString(),
    summary,
  };

  await fs.writeFile(markerPath, JSON.stringify(metadata, null, 2), "utf8");
  return metadata;
}

export async function cleanupImportedDraftAssets({
  draftsRoot,
  retentionMs,
  now = new Date(),
}) {
  const root = path.resolve(draftsRoot);
  const cleanedDrafts = [];
  let entries = [];

  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return { cleanedDrafts };
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const draftDir = path.join(root, entry.name);
    const markerPath = path.join(draftDir, IMPORTED_MARKER);
    const assetsDir = path.join(draftDir, ASSETS_DIR);
    const marker = await readJsonFile(markerPath);
    if (!marker?.importedAt) continue;

    const importedAt = new Date(marker.importedAt);
    if (Number.isNaN(importedAt.getTime())) continue;
    if (now.getTime() - importedAt.getTime() < retentionMs) continue;
    if (!(await pathExists(assetsDir))) continue;

    await fs.rm(assetsDir, { recursive: true, force: true });
    cleanedDrafts.push(draftDir);
  }

  return { cleanedDrafts };
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
