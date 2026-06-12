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
