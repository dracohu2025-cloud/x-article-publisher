import { inlineMarkdownToHtml } from "./html.mjs";

const IMAGE_RE = /^<image\s+([^>]+)\/>\s*$/;
const ATTR_RE = /([a-zA-Z_-]+)="([^"]*)"/g;

function attrsToObject(value) {
  const attrs = {};
  for (const match of value.matchAll(ATTR_RE)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function pushParagraph(blocks, lines) {
  if (lines.length === 0) return;
  for (const line of lines) {
    if (!line.trim()) continue;
    blocks.push({
      type: "paragraph",
      text: line.trim(),
    });
  }
  lines.length = 0;
}

function pushList(blocks, list) {
  if (!list) return null;
  blocks.push(list);
  return null;
}

function pushQuote(blocks, lines) {
  if (lines.length === 0) return;
  blocks.push({
    type: "quote",
    text: lines.join("\n").trim(),
  });
  lines.length = 0;
}

function blockPreview(block) {
  if (!block) return "";
  const text = block.items ? block.items.join(" / ") : block.text;
  return String(text || "").replace(/\s+/g, " ").slice(0, 80);
}

export function parseLarkMarkdown(markdown) {
  const blocks = [];
  const images = [];
  const warnings = [];
  const paragraph = [];
  const quoteLines = [];
  let currentList = null;
  let inQuote = false;

  function flushTextBlocks() {
    pushParagraph(blocks, paragraph);
    currentList = pushList(blocks, currentList);
    pushQuote(blocks, quoteLines);
  }

  for (const rawLine of String(markdown).split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      if (!inQuote) {
        flushTextBlocks();
      }
      continue;
    }

    if (line === "<quote-container>") {
      flushTextBlocks();
      inQuote = true;
      continue;
    }

    if (line === "</quote-container>") {
      pushQuote(blocks, quoteLines);
      inQuote = false;
      continue;
    }

    const imageMatch = line.match(IMAGE_RE);
    if (imageMatch) {
      flushTextBlocks();
      const attrs = attrsToObject(imageMatch[1]);
      images.push({
        token: attrs.token,
        width: Number(attrs.width || 0) || undefined,
        height: Number(attrs.height || 0) || undefined,
        align: attrs.align,
        blockIndex: Math.max(blocks.length - 1, 0),
        afterText: blockPreview(blocks.at(-1)),
      });
      continue;
    }

    if (line.startsWith("<") && line.endsWith(">")) {
      warnings.push(`暂未识别的飞书块，已按普通文本降级: ${line}`);
    }

    if (inQuote) {
      quoteLines.push(line);
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushTextBlocks();
      blocks.push({
        type: "heading",
        level: Math.min(3, Math.max(2, headingMatch[1].length + 1)),
        text: headingMatch[2].trim(),
      });
      continue;
    }

    const unorderedMatch = line.match(/^[-*]\s+(.+)$/);
    if (unorderedMatch) {
      pushParagraph(blocks, paragraph);
      if (!currentList || currentList.type !== "unorderedList") {
        currentList = pushList(blocks, currentList);
        currentList = { type: "unorderedList", items: [] };
      }
      currentList.items.push(unorderedMatch[1].trim());
      continue;
    }

    const orderedMatch = line.match(/^\d+[.)]\s+(.+)$/);
    if (orderedMatch) {
      pushParagraph(blocks, paragraph);
      if (!currentList || currentList.type !== "orderedList") {
        currentList = pushList(blocks, currentList);
        currentList = { type: "orderedList", items: [] };
      }
      currentList.items.push(orderedMatch[1].trim());
      continue;
    }

    currentList = pushList(blocks, currentList);
    paragraph.push(line);
  }

  if (inQuote) {
    warnings.push("检测到未闭合的 quote-container，已按引用块收尾。");
  }
  flushTextBlocks();

  return {
    blocks,
    images,
    warnings,
  };
}

export function blocksToHtml(blocks) {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "heading": {
          const tag = block.level === 3 ? "h3" : "h2";
          return `<${tag}>${inlineMarkdownToHtml(block.text)}</${tag}>`;
        }
        case "unorderedList":
          return `<ul>${block.items
            .map((item) => `<li>${inlineMarkdownToHtml(item)}</li>`)
            .join("")}</ul>`;
        case "orderedList":
          return `<ol>${block.items
            .map((item) => `<li>${inlineMarkdownToHtml(item)}</li>`)
            .join("")}</ol>`;
        case "quote":
          return `<blockquote>${block.text
            .split(/\n+/)
            .map((line) => `<p>${inlineMarkdownToHtml(line)}</p>`)
            .join("")}</blockquote>`;
        case "paragraph":
        default:
          return `<p>${inlineMarkdownToHtml(block.text)}</p>`;
      }
    })
    .join("\n");
}

export function blocksToPlainText(blocks) {
  return blocks
    .map((block) => {
      if (block.items) return block.items.map((item) => `- ${item}`).join("\n");
      return block.text;
    })
    .filter(Boolean)
    .join("\n\n");
}

export function normalizeLarkMarkdown({ title, markdown }) {
  const parsed = parseLarkMarkdown(markdown);
  const [cover, ...contentImages] = parsed.images;

  return {
    title,
    bodyHtml: blocksToHtml(parsed.blocks),
    plainText: blocksToPlainText(parsed.blocks),
    coverImage: cover ?? null,
    contentImages,
    images: parsed.images,
    blocks: parsed.blocks,
    warnings: parsed.warnings,
    stats: {
      blockCount: parsed.blocks.length,
      imageCount: parsed.images.length,
      wordCountApprox: blocksToPlainText(parsed.blocks).length,
    },
  };
}
