import assert from "node:assert/strict";
import test from "node:test";
import { normalizeLarkMarkdown } from "../src/core/normalize-lark-markdown.mjs";

test("normalizes Feishu markdown into X Article draft shape", () => {
  const draft = normalizeLarkMarkdown({
    title: "测试标题",
    markdown: `第一段包含 https://example.com/ 链接
<image token="cover-token" width="1844" height="680" align="center"/>

- 第一项
- 第二项
<image token="body-token" width="640" height="480" align="center"/>

<quote-container>
注意：这是引用
</quote-container>
`,
  });

  assert.equal(draft.title, "测试标题");
  assert.equal(draft.coverImage, null);
  assert.equal(draft.contentImages[0].token, "cover-token");
  assert.equal(draft.contentImages[1].token, "body-token");
  assert.equal(draft.contentImages[1].blockIndex, 1);
  assert.match(draft.bodyHtml, /<ul><li>第一项<\/li><li>第二项<\/li><\/ul>/);
  assert.match(draft.bodyHtml, /<blockquote><p>注意：这是引用<\/p><\/blockquote>/);
  assert.match(draft.bodyHtml, /<a href="https:\/\/example.com\/">/);
});

test("preserves Feishu line breaks as separate paragraphs", () => {
  const draft = normalizeLarkMarkdown({
    title: "段落测试",
    markdown: `第一段
第二段
第三段`,
  });

  assert.match(draft.bodyHtml, /<p>第一段<\/p>\n<p>第二段<\/p>\n<p>第三段<\/p>/);
  assert.equal(draft.stats.blockCount, 3);
});

test("normalizes fenced code blocks for X Article code block import", () => {
  const draft = normalizeLarkMarkdown({
    title: "代码块测试",
    markdown: `这是今天早晨推送的cron job:

\`\`\`plaintext {wrap}
Cronjob Response: 微信读书飞书增量同步日报

(job_id: 5c625b6f8e6a)
  indented line
\`\`\`

收尾段落`,
  });

  assert.deepEqual(draft.blocks, [
    { type: "paragraph", text: "这是今天早晨推送的cron job:" },
    {
      type: "code",
      text: "Cronjob Response: 微信读书飞书增量同步日报\n\n(job_id: 5c625b6f8e6a)\n  indented line",
      language: "plaintext",
      meta: "{wrap}",
    },
    { type: "paragraph", text: "收尾段落" },
  ]);
  assert.match(
    draft.bodyHtml,
    /<pre><code>Cronjob Response: 微信读书飞书增量同步日报&#10;&#10;\(job_id: 5c625b6f8e6a\)&#10;  indented line<\/code><\/pre>/,
  );
  assert.doesNotMatch(draft.bodyHtml, /```/);
  assert.equal(draft.stats.blockCount, 3);
});

test("normalizes Feishu lark tables without leaking raw tags", () => {
  const draft = normalizeLarkMarkdown({
    title: "表格测试",
    markdown: `微信读书 skill 现在能让我直接替你查、整理、分析你的微信读书数据。

<lark-table rows="2" cols="3" column-widths="100,100,100">
  <lark-tr>
    <lark-td>
      **能力**
    </lark-td>
    <lark-td>
      **能帮你做什么**
    </lark-td>
    <lark-td>
      **你可以这样说**
    </lark-td>
  </lark-tr>
  <lark-tr>
    <lark-td>
      搜书
    </lark-td>
    <lark-td>
      搜微信读书书城，列书名、作者、评分
    </lark-td>
    <lark-td>
      “帮我搜《三体》”
    </lark-td>
  </lark-tr>
</lark-table>

收尾段落`,
  });

  assert.deepEqual(draft.blocks[1], {
    type: "table",
    rows: [
      ["**能力**", "**能帮你做什么**", "**你可以这样说**"],
      ["搜书", "搜微信读书书城，列书名、作者、评分", "“帮我搜《三体》”"],
    ],
    text:
      "能力 | 能帮你做什么 | 你可以这样说\n--- | --- | ---\n搜书 | 搜微信读书书城，列书名、作者、评分 | “帮我搜《三体》”",
    attrs: { rows: "2", cols: "3", "column-widths": "100,100,100" },
  });
  assert.match(draft.bodyHtml, /<table><thead><tr><th><strong>能力<\/strong><\/th>/);
  assert.match(draft.plainText, /能力 \| 能帮你做什么 \| 你可以这样说/);
  assert.doesNotMatch(draft.bodyHtml, /lark-table|lark-tr|lark-td/);
  assert.equal(draft.warnings.length, 0);
  assert.equal(draft.stats.blockCount, 3);
});

test("continues repeated Feishu ordered list numbers across media attachments", () => {
  const draft = normalizeLarkMarkdown({
    title: "有序列表测试",
    markdown: `## 步骤

1. 第一步
<image token="image-one" width="640" height="480" align="center"/>

1. 第二步
<quote-container>
第二步说明
</quote-container>

第二步附属说明

1. 第三步

---

1. 新列表第一步`,
  });

  assert.deepEqual(
    draft.blocks
      .filter((block) => block.type === "orderedList")
      .map((block) => ({ start: block.start, items: block.items })),
    [
      { start: 1, items: ["第一步"] },
      { start: 2, items: ["第二步"] },
      { start: 3, items: ["第三步"] },
      { start: 1, items: ["新列表第一步"] },
    ],
  );
  assert.match(draft.bodyHtml, /<ol><li>第一步<\/li><\/ol>/);
  assert.match(draft.bodyHtml, /<ol start="2"><li>第二步<\/li><\/ol>/);
  assert.match(draft.bodyHtml, /<ol start="3"><li>第三步<\/li><\/ol>/);
  assert.match(draft.plainText, /1\. 第一步/);
  assert.match(draft.plainText, /2\. 第二步/);
  assert.match(draft.plainText, /3\. 第三步/);
  assert.equal(draft.contentImages[0].blockIndex, 1);
});
