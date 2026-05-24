import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildDraftImages, downloadImages } from "../src/core/prepare-feishu-doc.mjs";

test("keeps the first Feishu image in the body image queue", () => {
  const result = buildDraftImages([
    { token: "first-token", blockIndex: 0, path: "/tmp/image-01.png" },
    { token: "second-token", blockIndex: 1, path: "/tmp/image-02.png" },
  ]);

  assert.equal(result.coverImage, null);
  assert.deepEqual(
    result.contentImages.map((image) => ({
      token: image.token,
      marker: image.marker,
    })),
    [
      { token: "first-token", marker: "[XAP-IMG-01]" },
      { token: "second-token", marker: "[XAP-IMG-02]" },
    ],
  );
});

test("adds table placeholders to the body image queue", () => {
  const rows = [
    ["**能力**", "**能帮你做什么**"],
    ["搜书", "搜微信读书书城"],
  ];
  const result = buildDraftImages(
    [{ token: "body-token", blockIndex: 0, path: "/tmp/image-01.png" }],
    [
      { type: "paragraph", text: "Intro" },
      { type: "table", rows },
      { type: "paragraph", text: "Outro" },
    ],
  );

  assert.equal(result.coverImage, null);
  assert.deepEqual(
    result.contentImages.map((image) => ({
      kind: image.kind,
      marker: image.marker,
      blockIndex: image.blockIndex,
      path: image.path,
      rows: image.table?.rows,
    })),
    [
      {
        kind: undefined,
        marker: "[XAP-IMG-01]",
        blockIndex: 0,
        path: "/tmp/image-01.png",
        rows: undefined,
      },
      {
        kind: "table",
        marker: "[XAP-IMG-02]",
        blockIndex: 1,
        path: undefined,
        rows,
      },
    ],
  );
});

test("retries transient Feishu media download failures", async () => {
  const assetsDir = await fs.mkdtemp(path.join(os.tmpdir(), "xap-media-retry-"));
  let calls = 0;
  const result = await downloadImages(
    [{ token: "retry-token", blockIndex: 0 }],
    assetsDir,
    {
      maxAttempts: 3,
      retryDelayMs: 0,
      downloadMediaFn: async (_token, target) => {
        calls += 1;
        if (calls < 3) throw new Error(`temporary failure ${calls}`);
        await fs.writeFile(path.join(target.cwd, `${target.output}.png`), "image");
      },
    },
  );

  assert.equal(calls, 3);
  assert.equal(result.length, 1);
  assert.equal(result[0].token, "retry-token");
  assert.match(result[0].path, /image-01\.png$/);
  assert.match(result[0].downloadWarning, /前 2 次下载失败后重试成功/);
});

test("keeps media token after retry attempts fail", async () => {
  const assetsDir = await fs.mkdtemp(path.join(os.tmpdir(), "xap-media-fail-"));
  let calls = 0;
  const result = await downloadImages(
    [{ token: "failed-token", blockIndex: 0 }],
    assetsDir,
    {
      maxAttempts: 2,
      retryDelayMs: 0,
      downloadMediaFn: async () => {
        calls += 1;
        throw new Error(`permanent failure ${calls}`);
      },
    },
  );

  assert.equal(calls, 2);
  assert.equal(result.length, 1);
  assert.equal(result[0].token, "failed-token");
  assert.equal(result[0].path, undefined);
  assert.match(result[0].downloadError, /permanent failure 2/);
});
