import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadPanelState() {
  const source = fs.readFileSync(
    new URL("../extension/panel-state.js", import.meta.url),
    "utf8",
  );
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  return sandbox.XAPPanelState;
}

test("shows only input and prepare controls before draft exists", () => {
  const panelState = loadPanelState();
  const view = panelState.buildPanelView({ draft: null, preparing: false, importing: false });

  assert.equal(view.mode, "empty");
  assert.equal(view.sections.input, true);
  assert.equal(view.sections.prepareActions, true);
  assert.equal(view.sections.summary, false);
  assert.equal(view.sections.draftActions, false);
  assert.equal(view.buttons.prepare.visible, true);
  assert.equal(view.buttons.copyTitle.visible, false);
  assert.equal(view.buttons.import.visible, false);
  assert.equal(view.buttons.reload.visible, false);
  assert.equal(view.buttons.clearDraft.visible, false);
});

test("hides draft-only controls while generating a draft", () => {
  const panelState = loadPanelState();
  const view = panelState.buildPanelView({ draft: null, preparing: true, importing: false });

  assert.equal(view.mode, "preparing");
  assert.equal(view.sections.input, true);
  assert.equal(view.sections.prepareActions, true);
  assert.equal(view.sections.summary, false);
  assert.equal(view.sections.hint, false);
  assert.equal(view.sections.draftActions, false);
  assert.equal(view.buttons.prepare.enabled, false);
});

test("shows draft actions only after draft is ready", () => {
  const panelState = loadPanelState();
  const view = panelState.buildPanelView({ draft: { title: "Demo" }, preparing: false, importing: false });

  assert.equal(view.mode, "ready");
  assert.equal(view.sections.input, true);
  assert.equal(view.sections.prepareActions, true);
  assert.equal(view.sections.summary, true);
  assert.equal(view.sections.hint, true);
  assert.equal(view.sections.draftActions, true);
  assert.equal(view.buttons.copyTitle.visible, true);
  assert.equal(view.buttons.import.visible, true);
  assert.equal(view.buttons.reload.visible, true);
  assert.equal(view.buttons.clearDraft.visible, true);
});

test("keeps only import progress controls visible during import", () => {
  const panelState = loadPanelState();
  const view = panelState.buildPanelView({ draft: { title: "Demo" }, preparing: false, importing: true });

  assert.equal(view.mode, "importing");
  assert.equal(view.sections.input, false);
  assert.equal(view.sections.prepareActions, false);
  assert.equal(view.sections.summary, true);
  assert.equal(view.sections.hint, false);
  assert.equal(view.sections.draftActions, true);
  assert.equal(view.buttons.copyTitle.visible, false);
  assert.equal(view.buttons.import.visible, true);
  assert.equal(view.buttons.import.enabled, false);
  assert.equal(view.buttons.reload.visible, false);
  assert.equal(view.buttons.clearDraft.visible, false);
});
