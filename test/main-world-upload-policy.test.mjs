import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadMainWorldPolicy() {
  const source = fs.readFileSync(
    new URL("../extension/main-world.js", import.meta.url),
    "utf8",
  );
  const messages = [];
  const sandbox = {
    window: {
      addEventListener() {},
      postMessage(message) {
        messages.push(message);
      },
    },
    document: {
      querySelectorAll() {
        return [];
      },
    },
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  return { policy: sandbox.window.__XAP_UPLOAD_POLICY, messages };
}

test("uses longer media upload timeout for large X Article batches", () => {
  const { policy } = loadMainWorldPolicy();

  assert.ok(policy);
  assert.equal(policy.uploadTimeoutMs({ total: 1, index: 1, attempt: 1 }), 45_000);
  assert.ok(policy.uploadTimeoutMs({ total: 25, index: 17, attempt: 1 }) >= 90_000);
  assert.ok(policy.uploadTimeoutMs({ total: 25, index: 17, attempt: 2 }) > 90_000);
  assert.ok(policy.retryDelayMs({ total: 25, attempt: 1 }) >= 5_000);
});

test("resumes only image operations whose markers remain in the editor", () => {
  const { policy } = loadMainWorldPolicy();
  const imageOps = Array.from({ length: 5 }, (_value, index) => ({
    marker: `[XAP-IMG-${String(index + 1).padStart(2, "0")}]`,
  }));

  const result = policy.pendingImageOperations(
    imageOps,
    new Set(["[XAP-IMG-02]", "[XAP-IMG-05]"]),
  );

  assert.equal(result.resuming, true);
  assert.deepEqual(
    result.imageOps.map((image) => image.marker),
    ["[XAP-IMG-02]", "[XAP-IMG-05]"],
  );
});

test("announces resume capability in ready messages", () => {
  const { messages } = loadMainWorldPolicy();
  const ready = messages.find((message) => message.kind === "ready");

  assert.ok(ready);
  assert.match(ready.version, /^draft-block-write-/);
  assert.equal(ready.capabilities?.resumeMarkers, true);
  assert.equal(ready.capabilities?.batchedUploads, true);
});

test("splits large image imports into small upload batches", () => {
  const { policy } = loadMainWorldPolicy();
  const imageOps = Array.from({ length: 12 }, (_value, index) => ({
    marker: `[XAP-IMG-${String(index + 1).padStart(2, "0")}]`,
  }));
  const batchSizes = policy.imageUploadBatches(imageOps).map((batch) => batch.length);

  assert.equal(JSON.stringify(batchSizes), JSON.stringify([5, 5, 2]));
});

test("selects the next resumable image batch from remaining markers", () => {
  const { policy } = loadMainWorldPolicy();
  const imageOps = Array.from({ length: 6 }, (_value, index) => ({
    marker: `[XAP-IMG-${String(index + 1).padStart(2, "0")}]`,
  }));
  const attempts = new Map([
    ["[XAP-IMG-02]", 3],
  ]);

  const result = policy.nextPendingImageBatch(
    imageOps,
    new Set(["[XAP-IMG-01]", "[XAP-IMG-02]", "[XAP-IMG-03]", "[XAP-IMG-04]"]),
    attempts,
    { batchSize: 2, maxAttempts: 3 },
  );

  assert.deepEqual(
    result.imageOps.map((image) => image.marker),
    ["[XAP-IMG-01]", "[XAP-IMG-03]"],
  );
  assert.equal(result.pendingCount, 3);
  assert.equal(result.exhaustedCount, 1);
});

test("does not count uploaded images with uncleared markers as upload failures", () => {
  const { policy } = loadMainWorldPolicy();
  const imageOps = Array.from({ length: 3 }, (_value, index) => ({
    marker: `[XAP-IMG-${String(index + 1).padStart(2, "0")}]`,
  }));

  const result = policy.summarizeImageImport(
    imageOps,
    new Set(["[XAP-IMG-01]", "[XAP-IMG-02]", "[XAP-IMG-03]"]),
    new Set(["[XAP-IMG-01]", "[XAP-IMG-02]", "[XAP-IMG-03]"]),
    new Map(),
  );

  assert.equal(result.imgOk, 3);
  assert.equal(result.imgFail, 0);
  assert.equal(result.markerCleanupPending, 3);
  assert.equal(result.markerCount, 3);
  assert.deepEqual(result.imageErrors, []);
});
