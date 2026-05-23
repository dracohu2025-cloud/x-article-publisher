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
