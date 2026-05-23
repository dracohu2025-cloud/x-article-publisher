import assert from "node:assert/strict";
import test from "node:test";
import { buildDraftImages } from "../src/core/prepare-feishu-doc.mjs";

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
