import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadExtensionContext() {
  const source = fs.readFileSync(
    new URL("../extension/extension-context.js", import.meta.url),
    "utf8",
  );
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  return sandbox.XAPExtensionContext;
}

test("detects Chrome extension context invalidation errors", () => {
  const context = loadExtensionContext();

  assert.equal(
    context.isExtensionContextInvalidated(
      new Error("Extension context invalidated."),
    ),
    true,
  );
  assert.equal(context.isExtensionContextInvalidated(new Error("network failed")), false);
});

test("formats extension reload recovery message", () => {
  const context = loadExtensionContext();

  assert.equal(
    context.extensionReloadMessage(),
    "插件刚重新加载，当前页面还在使用旧脚本。请刷新 X Articles 页面后点击“刷新草稿”。",
  );
});
