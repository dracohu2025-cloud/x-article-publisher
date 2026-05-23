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
