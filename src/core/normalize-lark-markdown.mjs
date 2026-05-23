import { escapeHtml, inlineMarkdownToHtml } from "./html.mjs";

const IMAGE_RE = /^<image\s+([^>]+)\/>\s*$/;
const ATTR_RE = /([a-zA-Z_-]+)="([^"]*)"/g;
const CODE_FENCE_RE = /^```(.*)$/;
const CODE_FENCE_CLOSE_RE = /^```\s*$/;
const LARK_TABLE_OPEN_RE = /^<lark-table\b([^>]*)>\s*$/;
const LARK_TABLE_CLOSE_RE = /^<\/lark-table>\s*$/;
const LARK_TABLE_ROW_OPEN_RE = /^<lark-tr\b[^>]*>\s*$/;
const LARK_TABLE_ROW_CLOSE_RE = /^<\/lark-tr>\s*$/;
const LARK_TABLE_CELL_OPEN_RE = /^<lark-td\b[^>]*>\s*$/;
const LARK_TABLE_CELL_CLOSE_RE = /^<\/lark-td>\s*$/;

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

function pushCode(blocks, code) {
  if (!code) return null;
  const block = {
    type: "code",
    text: code.lines.join("\n"),
  };
  if (code.language) block.language = code.language;
  if (code.meta) block.meta = code.meta;
  blocks.push(block);
  return null;
}

function normalizeTableCell(value) {
  return String(value || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function normalizeTableRows(rows) {
  return rows
    .map((row) => row.map(normalizeTableCell))
    .filter((row) => row.some(Boolean));
}

function pushTable(blocks, table) {
  if (!table) return null;
  closeTableCell(table);
  closeTableRow(table);
  const rows = normalizeTableRows(table.rows);
  if (rows.length > 0) {
    blocks.push({
      type: "table",
      rows,
      text: tableToPlainText(rows),
      attrs: table.attrs,
    });
  }
  return null;
}

function closeTableCell(table) {
  if (!table?.currentCell) return;
  table.currentRow ||= [];
  table.currentRow.push(table.currentCell.join("\n"));
  table.currentCell = null;
}

function closeTableRow(table) {
  if (!table?.currentRow) return;
  closeTableCell(table);
  table.rows.push(table.currentRow);
  table.currentRow = null;
}

function parseCodeFenceInfo(info) {
  const trimmed = String(info || "").trim();
  if (!trimmed) return {};
  const [language, ...metaParts] = trimmed.split(/\s+/);
  return {
    language,
    meta: metaParts.join(" ") || undefined,
  };
}

function tableCellToPlainText(value) {
  return normalizeTableCell(value)
    .replace(/\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/\|/g, "/")
    .trim();
}

function tableToPlainText(rows) {
  const normalizedRows = normalizeTableRows(rows).map((row) => row.map(tableCellToPlainText));
  if (!normalizedRows.length) return "";
  const columnCount = Math.max(...normalizedRows.map((row) => row.length));
  const fullRows = normalizedRows.map((row) =>
    Array.from({ length: columnCount }, (_value, index) => row[index] || ""),
  );
  const lines = [fullRows[0].join(" | ")];
  if (fullRows.length > 1) {
    lines.push(Array.from({ length: columnCount }, () => "---").join(" | "));
    lines.push(...fullRows.slice(1).map((row) => row.join(" | ")));
  }
  return lines.join("\n");
}

function blockPreview(block) {
  if (!block) return "";
  const text = block.rows ? tableToPlainText(block.rows) : block.items ? block.items.join(" / ") : block.text;
  return String(text || "").replace(/\s+/g, " ").slice(0, 80);
}

function linesResetOrderedNumber(lines) {
  return lines.some((line) => /^-{3,}$/.test(String(line || "").trim()));
}

export function parseLarkMarkdown(markdown) {
  const blocks = [];
  const images = [];
  const warnings = [];
  const paragraph = [];
  const quoteLines = [];
  let currentList = null;
  let inQuote = false;
  let currentCode = null;
  let currentTable = null;
  let nextOrderedNumber = null;

  function flushTextBlocks() {
    const resetOrdered = linesResetOrderedNumber(paragraph);
    pushParagraph(blocks, paragraph);
    currentList = pushList(blocks, currentList);
    pushQuote(blocks, quoteLines);
    if (resetOrdered) resetOrderedNumber();
  }

  function resetOrderedNumber() {
    nextOrderedNumber = null;
  }

  for (const rawLine of String(markdown).split(/\r?\n/)) {
    if (currentCode) {
      if (CODE_FENCE_CLOSE_RE.test(rawLine.trim())) {
        currentCode = pushCode(blocks, currentCode);
      } else {
        currentCode.lines.push(rawLine);
      }
      continue;
    }

    const line = rawLine.trim();

    if (currentTable) {
      if (LARK_TABLE_CLOSE_RE.test(line)) {
        currentTable = pushTable(blocks, currentTable);
      } else if (LARK_TABLE_ROW_OPEN_RE.test(line)) {
        closeTableRow(currentTable);
        currentTable.currentRow = [];
      } else if (LARK_TABLE_ROW_CLOSE_RE.test(line)) {
        closeTableRow(currentTable);
      } else if (LARK_TABLE_CELL_OPEN_RE.test(line)) {
        closeTableCell(currentTable);
        currentTable.currentCell = [];
      } else if (LARK_TABLE_CELL_CLOSE_RE.test(line)) {
        closeTableCell(currentTable);
      } else if (currentTable.currentCell && line) {
        currentTable.currentCell.push(line);
      }
      continue;
    }

    if (!line) {
      if (!inQuote) {
        flushTextBlocks();
      }
      continue;
    }

    const codeFenceMatch = line.match(CODE_FENCE_RE);
    if (!inQuote && codeFenceMatch) {
      flushTextBlocks();
      currentCode = {
        ...parseCodeFenceInfo(codeFenceMatch[1]),
        lines: [],
      };
      continue;
    }

    const tableMatch = line.match(LARK_TABLE_OPEN_RE);
    if (!inQuote && tableMatch) {
      flushTextBlocks();
      currentTable = {
        attrs: attrsToObject(tableMatch[1]),
        rows: [],
        currentRow: null,
        currentCell: null,
      };
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
      resetOrderedNumber();
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
      const resetOrdered = linesResetOrderedNumber(paragraph);
      pushParagraph(blocks, paragraph);
      if (resetOrdered) resetOrderedNumber();
      if (!currentList || currentList.type !== "orderedList") {
        currentList = pushList(blocks, currentList);
        currentList = {
          type: "orderedList",
          start: nextOrderedNumber || Number(orderedMatch[0].match(/^\d+/)?.[0] || 1),
          items: [],
        };
      }
      currentList.items.push(orderedMatch[1].trim());
      nextOrderedNumber = currentList.start + currentList.items.length;
      continue;
    }

    currentList = pushList(blocks, currentList);
    paragraph.push(line);
  }

  if (inQuote) {
    warnings.push("检测到未闭合的 quote-container，已按引用块收尾。");
  }
  if (currentCode) {
    warnings.push("检测到未闭合的代码块，已按代码块收尾。");
    currentCode = pushCode(blocks, currentCode);
  }
  if (currentTable) {
    warnings.push("检测到未闭合的飞书表格，已按表格块收尾。");
    currentTable = pushTable(blocks, currentTable);
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
          return `<ol${block.start && block.start > 1 ? ` start="${block.start}"` : ""}>${block.items
            .map((item) => `<li>${inlineMarkdownToHtml(item)}</li>`)
            .join("")}</ol>`;
        case "quote":
          return `<blockquote>${block.text
            .split(/\n+/)
            .map((line) => `<p>${inlineMarkdownToHtml(line)}</p>`)
            .join("")}</blockquote>`;
        case "code":
          return `<pre><code>${escapeHtml(block.text).replace(/\n/g, "&#10;")}</code></pre>`;
        case "table": {
          const rows = normalizeTableRows(block.rows);
          const headerRows = rows.slice(0, 1);
          const bodyRows = rows.slice(1);
          const header = headerRows.length
            ? `<thead>${headerRows
                .map((row) => `<tr>${row.map((cell) => `<th>${inlineMarkdownToHtml(cell)}</th>`).join("")}</tr>`)
                .join("")}</thead>`
            : "";
          const body = `<tbody>${bodyRows
            .map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdownToHtml(cell)}</td>`).join("")}</tr>`)
            .join("")}</tbody>`;
          return `<table>${header}${body}</table>`;
        }
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
      if (block.type === "orderedList") {
        const start = Number(block.start || 1);
        return block.items.map((item, index) => `${start + index}. ${item}`).join("\n");
      }
      if (block.items) return block.items.map((item) => `- ${item}`).join("\n");
      if (block.type === "code") return block.text;
      if (block.type === "table") return tableToPlainText(block.rows);
      return block.text;
    })
    .filter(Boolean)
    .join("\n\n");
}

export function normalizeLarkMarkdown({ title, markdown }) {
  const parsed = parseLarkMarkdown(markdown);

  return {
    title,
    bodyHtml: blocksToHtml(parsed.blocks),
    plainText: blocksToPlainText(parsed.blocks),
    coverImage: null,
    contentImages: parsed.images,
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
