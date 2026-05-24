import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadPlanner(overrides = {}) {
  const source = fs.readFileSync(
    new URL("../extension/x-import-plan.js", import.meta.url),
    "utf8",
  );
  const sandbox = { ...overrides };
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

test("skips unavailable image markers and preserves original marker numbers", () => {
  const planner = loadPlanner();
  const plan = planner.buildXImportPlan({
    blocks: [
      { type: "heading", level: 3, text: "第一张" },
      { type: "heading", level: 3, text: "第二张" },
      { type: "heading", level: 3, text: "第三张" },
    ],
    contentImages: [
      { marker: "[XAP-IMG-01]", blockIndex: 0, token: "missing-token" },
      { marker: "[XAP-IMG-02]", blockIndex: 1, path: "/tmp/image-02.png" },
      { marker: "[XAP-IMG-03]", blockIndex: 2, path: "/tmp/image-03.png" },
    ],
  });

  const markerBlocks = plan.blocks
    .map((block) => block.text)
    .filter((text) => String(text || "").startsWith("[XAP-IMG-"));

  assert.deepEqual(markerBlocks, ["[XAP-IMG-02]", "[XAP-IMG-03]"]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(plan.images)),
    [
      {
        marker: "[XAP-IMG-02]",
        path: "/tmp/image-02.png",
        blockIndex: 1,
      },
      {
        marker: "[XAP-IMG-03]",
        path: "/tmp/image-03.png",
        blockIndex: 2,
      },
    ],
  );
  assert.equal(plan.skippedImages.length, 1);
  assert.equal(plan.unavailableImages.length, 1);
  assert.equal(plan.limitSkippedImages.length, 0);
  assert.equal(plan.totalContentImages, 3);
  assert.equal(plan.importableContentImages, 2);
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

test("maps normalized code blocks to Draft.js code-block lines", () => {
  const planner = loadPlanner();
  const plan = planner.buildXImportPlan({
    plainText: "Intro\n\nline one\n\nline three\n\nOutro",
    blocks: [
      { type: "paragraph", text: "Intro" },
      { type: "code", text: "line one\n\nline three", language: "plaintext" },
      { type: "paragraph", text: "Outro" },
    ],
    contentImages: [
      { marker: "[XAP-IMG-01]", blockIndex: 1, path: "/tmp/image-01.png" },
    ],
  });

  assert.deepEqual(
    plan.blocks.map((block) => ({ type: block.type, text: block.text })),
    [
      { type: "unstyled", text: "Intro" },
      { type: "code-block", text: "line one" },
      { type: "code-block", text: "" },
      { type: "code-block", text: "line three" },
      { type: "unstyled", text: "[XAP-IMG-01]" },
      { type: "unstyled", text: "Outro" },
    ],
  );
});

test("maps HTML pre blocks to Draft.js code-block lines", () => {
  const planner = loadPlanner({
    DOMParser: class {
      parseFromString() {
        return {
          querySelector() {
            return {
              children: [
                {
                  tagName: "PRE",
                  textContent: "line one\nline two\n",
                },
              ],
            };
          },
        };
      }
    },
  });
  const plan = planner.buildXImportPlan({
    bodyHtml: "<pre><code>line one&#10;line two</code></pre>",
    plainText: "line one\nline two",
    contentImages: [],
  });

  assert.deepEqual(
    JSON.parse(
      JSON.stringify(plan.blocks.map((block) => ({ type: block.type, text: block.text }))),
    ),
    [
      { type: "code-block", text: "line one" },
      { type: "code-block", text: "line two" },
    ],
  );
});

test("maps normalized table blocks to Draft.js code-block table lines", () => {
  const planner = loadPlanner();
  const plan = planner.buildXImportPlan({
    plainText: "Intro\n\n能力 | 能帮你做什么\n--- | ---\n搜书 | 搜微信读书书城\n\nOutro",
    blocks: [
      { type: "paragraph", text: "Intro" },
      {
        type: "table",
        rows: [
          ["**能力**", "**能帮你做什么**"],
          ["搜书", "搜微信读书书城"],
        ],
      },
      { type: "paragraph", text: "Outro" },
    ],
    contentImages: [
      { marker: "[XAP-IMG-01]", blockIndex: 1, path: "/tmp/image-01.png" },
    ],
  });

  assert.deepEqual(
    plan.blocks.map((block) => ({ type: block.type, text: block.text })),
    [
      { type: "unstyled", text: "Intro" },
      { type: "code-block", text: "能力 | 能帮你做什么" },
      { type: "code-block", text: "--- | ---" },
      { type: "code-block", text: "搜书 | 搜微信读书书城" },
      { type: "unstyled", text: "[XAP-IMG-01]" },
      { type: "unstyled", text: "Outro" },
    ],
  );
});

test("uses rendered table image markers instead of duplicate table text", () => {
  const planner = loadPlanner();
  const rows = [
    ["**能力**", "**能帮你做什么**"],
    ["搜书", "搜微信读书书城"],
  ];
  const plan = planner.buildXImportPlan({
    plainText: "Intro\n\n能力 | 能帮你做什么\n--- | ---\n搜书 | 搜微信读书书城\n\nOutro",
    blocks: [
      { type: "paragraph", text: "Intro" },
      { type: "table", rows },
      { type: "paragraph", text: "Outro" },
    ],
    contentImages: [
      {
        kind: "table",
        marker: "[XAP-IMG-01]",
        blockIndex: 1,
        table: { rows },
      },
    ],
  });

  assert.deepEqual(
    plan.blocks.map((block) => ({ type: block.type, text: block.text })),
    [
      { type: "unstyled", text: "Intro" },
      { type: "unstyled", text: "[XAP-IMG-01]" },
      { type: "unstyled", text: "Outro" },
    ],
  );
  assert.deepEqual(JSON.parse(JSON.stringify(plan.images)), [
    {
      kind: "table",
      marker: "[XAP-IMG-01]",
      blockIndex: 1,
      table: { rows },
    },
  ]);
  assert.equal(plan.importableContentImages, 1);
});

test("maps HTML table blocks to Draft.js code-block table lines", () => {
  const table = {
    tagName: "TABLE",
    querySelectorAll(selector) {
      if (selector !== "tr") return [];
      return [
        {
          children: [
            { tagName: "TH", textContent: "能力" },
            { tagName: "TH", textContent: "能帮你做什么" },
          ],
        },
        {
          children: [
            { tagName: "TD", textContent: "搜书" },
            { tagName: "TD", textContent: "搜微信读书书城" },
          ],
        },
      ];
    },
  };
  const planner = loadPlanner({
    DOMParser: class {
      parseFromString() {
        return {
          querySelector() {
            return { children: [table] };
          },
        };
      }
    },
  });
  const plan = planner.buildXImportPlan({
    bodyHtml: "<table><thead><tr><th>能力</th><th>能帮你做什么</th></tr></thead></table>",
    plainText: "",
    contentImages: [],
  });

  assert.deepEqual(
    JSON.parse(
      JSON.stringify(plan.blocks.map((block) => ({ type: block.type, text: block.text }))),
    ),
    [
      { type: "code-block", text: "能力 | 能帮你做什么" },
      { type: "code-block", text: "--- | ---" },
      { type: "code-block", text: "搜书 | 搜微信读书书城" },
    ],
  );
});

test("imports ordered lists as explicit numbered paragraphs", () => {
  const planner = loadPlanner({
    Node: {
      TEXT_NODE: 3,
      ELEMENT_NODE: 1,
    },
    DOMParser: class {
      parseFromString() {
        const text = (value) => ({ nodeType: 3, nodeValue: value });
        const li = (value) => ({
          nodeType: 1,
          tagName: "LI",
          childNodes: [text(value)],
          getAttribute() {
            return null;
          },
        });
        return {
          querySelector() {
            return {
              children: [
                {
                  nodeType: 1,
                  tagName: "OL",
                  children: [li("第二步"), li("第三步")],
                  getAttribute(name) {
                    return name === "start" ? "2" : null;
                  },
                },
              ],
            };
          },
        };
      }
    },
  });
  const plan = planner.buildXImportPlan({
    bodyHtml: '<ol start="2"><li>第二步</li><li>第三步</li></ol>',
    plainText: "",
    contentImages: [],
  });

  assert.deepEqual(
    JSON.parse(
      JSON.stringify(plan.blocks.map((block) => ({ type: block.type, text: block.text }))),
    ),
    [
      { type: "unstyled", text: "2. 第二步" },
      { type: "unstyled", text: "3. 第三步" },
    ],
  );
});

test("imports structured ordered lists as explicit numbered paragraphs before markers", () => {
  const planner = loadPlanner();
  const plan = planner.buildXImportPlan({
    blocks: [
      { type: "orderedList", start: 2, items: ["第二步"] },
      { type: "orderedList", start: 3, items: ["第三步"] },
    ],
    contentImages: [
      { marker: "[XAP-IMG-01]", blockIndex: 0, path: "/tmp/image-01.png" },
    ],
  });

  assert.deepEqual(
    plan.blocks.map((block) => ({ type: block.type, text: block.text })),
    [
      { type: "unstyled", text: "2. 第二步" },
      { type: "unstyled", text: "[XAP-IMG-01]" },
      { type: "unstyled", text: "3. 第三步" },
    ],
  );
});
