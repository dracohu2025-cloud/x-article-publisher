import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadPlanner() {
  const source = fs.readFileSync(
    new URL("../extension/x-import-plan.js", import.meta.url),
    "utf8",
  );
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox);
  return sandbox.XAPImportPlan;
}

test("builds X import plan with image markers and upload operations", () => {
  const planner = loadPlanner();
  const plan = planner.buildXImportPlan({
    bodyHtml: "<p>第一段</p>\n<p>第二段</p>",
    plainText: "第一段\n\n第二段",
    contentImages: [
      {
        marker: "[XAP-IMG-01]",
        blockIndex: 0,
        path: "/tmp/image-01.png",
        token: "image-token",
      },
    ],
  });

  assert.match(plan.html, /<p>第一段<\/p>\n<p><strong>\[XAP-IMG-01]<\/strong><\/p>\n<p>第二段<\/p>/);
  assert.match(plan.plain, /第一段\n\n\[XAP-IMG-01]\n\n第二段/);
  assert.equal(plan.markerPrefix, "[XAP-IMG-");
  assert.deepEqual(JSON.parse(JSON.stringify(plan.images)), [
    {
      marker: "[XAP-IMG-01]",
      path: "/tmp/image-01.png",
      token: "image-token",
      blockIndex: 0,
    },
  ]);
});

test("limits content images and omits skipped markers", () => {
  const planner = loadPlanner();
  const plan = planner.buildXImportPlan(
    {
      bodyHtml: "<p>第一段</p>\n<p>第二段</p>\n<p>第三段</p>",
      plainText: "第一段\n\n第二段\n\n第三段",
      contentImages: [
        { marker: "[XAP-IMG-01]", blockIndex: 0, path: "/tmp/image-01.png" },
        { marker: "[XAP-IMG-02]", blockIndex: 1, path: "/tmp/image-02.png" },
        { marker: "[XAP-IMG-03]", blockIndex: 2, path: "/tmp/image-03.png" },
      ],
    },
    { maxContentImages: 2 },
  );

  assert.match(plan.html, /\[XAP-IMG-01]/);
  assert.match(plan.html, /\[XAP-IMG-02]/);
  assert.doesNotMatch(plan.html, /\[XAP-IMG-03]/);
  assert.equal(plan.images.length, 2);
  assert.equal(plan.skippedImages.length, 1);
  assert.equal(plan.maxContentImages, 2);
  assert.equal(plan.totalContentImages, 3);
});

test("builds structured Draft.js blocks with markers after source blocks", () => {
  const planner = loadPlanner();
  const plan = planner.buildXImportPlan({
    plainText: "Intro\n\n- A\n- B\n\nOutro",
    blocks: [
      { type: "paragraph", text: "Intro" },
      { type: "unorderedList", items: ["A", "B"] },
      { type: "quote", text: "Outro" },
    ],
    contentImages: [
      { marker: "[XAP-IMG-01]", blockIndex: 1, path: "/tmp/image-01.png" },
    ],
  });

  assert.deepEqual(
    plan.blocks.map((block) => ({ type: block.type, text: block.text })),
    [
      { type: "unstyled", text: "Intro" },
      { type: "unordered-list-item", text: "A" },
      { type: "unordered-list-item", text: "B" },
      { type: "unstyled", text: "[XAP-IMG-01]" },
      { type: "blockquote", text: "Outro" },
    ],
  );
});
