import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanupImportedDraftAssets, markDraftImported } from "../src/server/draft-cleanup.mjs";

async function makeTempDraft() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "xap-cleanup-"));
  const draftsRoot = path.join(root, ".xap", "drafts");
  const draftDir = path.join(draftsRoot, "demo-draft");
  const assetsDir = path.join(draftDir, "assets");
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.writeFile(path.join(draftDir, "draft.json"), "{}", "utf8");
  await fs.writeFile(path.join(draftDir, "body.html"), "<p>demo</p>", "utf8");
  await fs.writeFile(path.join(draftDir, "source.md"), "demo", "utf8");
  await fs.writeFile(path.join(assetsDir, "image.png"), "image", "utf8");
  return {
    root,
    draftsRoot,
    draftDir,
    draftPath: path.join(draftDir, "draft.json"),
    assetsDir,
  };
}

test("marks imported draft without deleting assets immediately", async () => {
  const temp = await makeTempDraft();
  try {
    const importedAt = new Date("2026-05-23T00:00:00.000Z");

    const metadata = await markDraftImported({
      draftsRoot: temp.draftsRoot,
      draftPath: temp.draftPath,
      importedAt,
      summary: { imgOk: 2 },
    });

    assert.equal(metadata.importedAt, importedAt.toISOString());
    assert.equal(metadata.summary.imgOk, 2);
    assert.equal(await exists(path.join(temp.assetsDir, "image.png")), true);
  } finally {
    await fs.rm(temp.root, { recursive: true, force: true });
  }
});

test("removes assets only after imported draft retention expires", async () => {
  const temp = await makeTempDraft();
  try {
    await markDraftImported({
      draftsRoot: temp.draftsRoot,
      draftPath: temp.draftPath,
      importedAt: new Date("2026-05-21T00:00:00.000Z"),
    });

    const result = await cleanupImportedDraftAssets({
      draftsRoot: temp.draftsRoot,
      retentionMs: 24 * 60 * 60 * 1000,
      now: new Date("2026-05-23T00:00:00.000Z"),
    });

    assert.deepEqual(result.cleanedDrafts, [temp.draftDir]);
    assert.equal(await exists(temp.assetsDir), false);
    assert.equal(await exists(path.join(temp.draftDir, "draft.json")), true);
    assert.equal(await exists(path.join(temp.draftDir, "body.html")), true);
    assert.equal(await exists(path.join(temp.draftDir, "source.md")), true);
  } finally {
    await fs.rm(temp.root, { recursive: true, force: true });
  }
});

test("keeps imported draft assets before retention expires", async () => {
  const temp = await makeTempDraft();
  try {
    await markDraftImported({
      draftsRoot: temp.draftsRoot,
      draftPath: temp.draftPath,
      importedAt: new Date("2026-05-22T12:00:00.000Z"),
    });

    const result = await cleanupImportedDraftAssets({
      draftsRoot: temp.draftsRoot,
      retentionMs: 24 * 60 * 60 * 1000,
      now: new Date("2026-05-23T00:00:00.000Z"),
    });

    assert.deepEqual(result.cleanedDrafts, []);
    assert.equal(await exists(path.join(temp.assetsDir, "image.png")), true);
  } finally {
    await fs.rm(temp.root, { recursive: true, force: true });
  }
});

test("does not report already cleaned imported assets again", async () => {
  const temp = await makeTempDraft();
  try {
    await markDraftImported({
      draftsRoot: temp.draftsRoot,
      draftPath: temp.draftPath,
      importedAt: new Date("2026-05-21T00:00:00.000Z"),
    });

    await cleanupImportedDraftAssets({
      draftsRoot: temp.draftsRoot,
      retentionMs: 24 * 60 * 60 * 1000,
      now: new Date("2026-05-23T00:00:00.000Z"),
    });
    const result = await cleanupImportedDraftAssets({
      draftsRoot: temp.draftsRoot,
      retentionMs: 24 * 60 * 60 * 1000,
      now: new Date("2026-05-23T00:00:00.000Z"),
    });

    assert.deepEqual(result.cleanedDrafts, []);
  } finally {
    await fs.rm(temp.root, { recursive: true, force: true });
  }
});

test("rejects imported draft markers outside drafts root", async () => {
  const temp = await makeTempDraft();
  try {
    await assert.rejects(
      () =>
        markDraftImported({
          draftsRoot: temp.draftsRoot,
          draftPath: path.join(temp.root, "outside", "draft.json"),
        }),
      /只允许标记/,
    );
  } finally {
    await fs.rm(temp.root, { recursive: true, force: true });
  }
});

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
