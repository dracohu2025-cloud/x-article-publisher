import assert from "node:assert/strict";
import test from "node:test";
import { mediaProgressStatus } from "../src/server/status-events.mjs";

test("keeps media progress count out of status message", () => {
  const status = mediaProgressStatus({
    type: "media-download-start",
    index: 1,
    total: 24,
    token: "token-1",
  });

  assert.equal(status.message, "正在下载图片");
  assert.equal(status.current, 1);
  assert.equal(status.total, 24);
});

test("keeps media completion count out of status message", () => {
  const status = mediaProgressStatus({
    type: "media-download-done",
    index: 2,
    total: 24,
    path: "/tmp/image.png",
  });

  assert.equal(status.message, "已下载图片");
  assert.equal(status.current, 2);
  assert.equal(status.total, 24);
  assert.equal(status.lastPath, "/tmp/image.png");
});

test("keeps media error count out of status message", () => {
  const status = mediaProgressStatus({
    type: "media-download-error",
    index: 3,
    total: 24,
    error: "timeout",
  });

  assert.equal(status.message, "图片下载失败，继续处理");
  assert.equal(status.current, 3);
  assert.equal(status.total, 24);
  assert.equal(status.error, "timeout");
});
