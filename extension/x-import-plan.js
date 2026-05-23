(function installXAPImportPlan(global) {
  const MARKER_PREFIX = "[XAP-IMG-";

  function markerForImage(image, index) {
    return image?.marker || `${MARKER_PREFIX}${String(index + 1).padStart(2, "0")}]`;
  }

  function groupMarkersByBlock(contentImages = []) {
    const markersByBlock = new Map();
    const images = [];

    contentImages.forEach((image, index) => {
      const marker = markerForImage(image, index);
      const blockIndex = Math.max(0, Number(image?.blockIndex || 0));
      const items = markersByBlock.get(blockIndex) || [];
      items.push(marker);
      markersByBlock.set(blockIndex, items);

      if (image?.path) {
        images.push({
          marker,
          path: image.path,
          token: image.token,
          blockIndex,
        });
      }
    });

    return { markersByBlock, images };
  }

  function mapDraftBlockType(block) {
    if (!block) return "unstyled";
    if (block.kind) return block.kind;
    if (block.type === "code") return "code-block";
    if (block.type === "heading") return `header-${block.level === 3 ? "three" : "two"}`;
    if (block.type === "quote") return "blockquote";
    if (block.type === "unorderedList") return "unordered-list-item";
    if (block.type === "orderedList") return "ordered-list-item";
    return "unstyled";
  }

  function emptyInline() {
    return { text: "", inlineStyleRanges: [], links: [] };
  }

  function appendInlineText(result, text, styles, linkUrl) {
    const value = String(text || "").replace(/\u00a0/g, " ");
    if (!value) return;
    const offset = result.text.length;
    result.text += value;
    for (const style of styles) {
      result.inlineStyleRanges.push({ offset, length: value.length, style });
    }
    if (linkUrl) {
      result.links.push({ offset, length: value.length, url: linkUrl });
    }
  }

  function mergeInline(target, source) {
    const offset = target.text.length;
    target.text += source.text;
    target.inlineStyleRanges.push(
      ...source.inlineStyleRanges.map((range) => ({
        ...range,
        offset: range.offset + offset,
      })),
    );
    target.links.push(
      ...source.links.map((link) => ({
        ...link,
        offset: link.offset + offset,
      })),
    );
  }

  function inlineFromNode(node, styles = [], linkUrl = null) {
    const result = emptyInline();
    if (!node) return result;

    if (node.nodeType === Node.TEXT_NODE) {
      appendInlineText(result, node.nodeValue, styles, linkUrl);
      return result;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return result;

    const tagName = node.tagName.toLowerCase();
    if (tagName === "br") {
      appendInlineText(result, "\n", styles, linkUrl);
      return result;
    }

    const nextStyles = styles.slice();
    if (tagName === "strong" || tagName === "b") nextStyles.push("Bold");
    if (tagName === "em" || tagName === "i") nextStyles.push("Italic");
    if (tagName === "s" || tagName === "del" || tagName === "strike") {
      nextStyles.push("Strikethrough");
    }
    if (tagName === "code") nextStyles.push("Code");

    const nextLink = tagName === "a" ? node.getAttribute("href") || linkUrl : linkUrl;
    for (const child of node.childNodes) {
      mergeInline(result, inlineFromNode(child, nextStyles, nextLink));
    }
    return result;
  }

  function trimInline(inline) {
    const text = String(inline?.text || "");
    const leading = text.match(/^\s*/)[0].length;
    const trailing = text.match(/\s*$/)[0].length;
    const start = leading;
    const end = text.length - trailing;
    if (start === 0 && end === text.length) return inline;
    const nextText = text.slice(start, end);

    function trimRange(range) {
      const rangeStart = range.offset;
      const rangeEnd = range.offset + range.length;
      const nextStart = Math.max(rangeStart, start);
      const nextEnd = Math.min(rangeEnd, end);
      if (nextEnd <= nextStart) return null;
      return {
        ...range,
        offset: nextStart - start,
        length: nextEnd - nextStart,
      };
    }

    return {
      text: nextText,
      inlineStyleRanges: (inline.inlineStyleRanges || []).map(trimRange).filter(Boolean),
      links: (inline.links || []).map(trimRange).filter(Boolean),
    };
  }

  function draftBlockFromInline(type, inline) {
    const trimmed = trimInline(inline);
    return {
      type: type || "unstyled",
      text: trimmed.text,
      inlineStyleRanges: trimmed.inlineStyleRanges,
      links: trimmed.links,
    };
  }

  function codeBlocksFromText(text) {
    const lines = String(text ?? "").split(/\n/);
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    return lines.map((line) => ({
      type: "code-block",
      text: line,
      inlineStyleRanges: [],
      links: [],
    }));
  }

  function sourceBlocksFromHtml(bodyHtml) {
    if (typeof DOMParser === "undefined" || !bodyHtml) return [];
    const doc = new DOMParser().parseFromString(
      `<main id="xap-import-root">${bodyHtml}</main>`,
      "text/html",
    );
    const root = doc.querySelector("#xap-import-root");
    if (!root) return [];

    return Array.from(root.children).map((element) => {
      const tagName = element.tagName.toLowerCase();
      if (tagName === "h1") {
        return [draftBlockFromInline("header-one", inlineFromNode(element))];
      }
      if (tagName === "h2") {
        return [draftBlockFromInline("header-two", inlineFromNode(element))];
      }
      if (tagName === "h3" || tagName === "h4" || tagName === "h5" || tagName === "h6") {
        return [draftBlockFromInline("header-three", inlineFromNode(element))];
      }
      if (tagName === "pre") {
        return codeBlocksFromText(element.textContent || "");
      }
      if (tagName === "blockquote") {
        const children = Array.from(element.children).filter((child) => child.tagName?.toLowerCase() === "p");
        const quoteBlocks = children.length ? children : [element];
        return quoteBlocks.map((child) => draftBlockFromInline("blockquote", inlineFromNode(child)));
      }
      if (tagName === "ul" || tagName === "ol") {
        const type = tagName === "ul" ? "unordered-list-item" : "ordered-list-item";
        return Array.from(element.children)
          .filter((child) => child.tagName?.toLowerCase() === "li")
          .map((child) => draftBlockFromInline(type, inlineFromNode(child)));
      }
      return [draftBlockFromInline("unstyled", inlineFromNode(element))];
    });
  }

  function sourceBlocksFromDraft(draft) {
    const htmlBlocks = sourceBlocksFromHtml(draft?.bodyHtml);
    if (htmlBlocks.length) return htmlBlocks;

    if (Array.isArray(draft?.blocks) && draft.blocks.length) {
      return draft.blocks.map((block) => {
        if (block.type === "code") {
          return codeBlocksFromText(block.text);
        }
        if (block.items) {
          return block.items.map((item) => ({
            type: mapDraftBlockType(block),
            text: String(item || ""),
            inlineStyleRanges: [],
            links: [],
          }));
        }
        return [
          {
            type: mapDraftBlockType(block),
            text: String(block.text || ""),
            inlineStyleRanges: block.inlineStyleRanges || [],
            links: block.links || [],
          },
        ];
      });
    }

    return String(draft?.plainText || "")
      .split(/\n{2,}/)
      .map((text) => [
        {
          type: "unstyled",
          text: text.trim(),
          inlineStyleRanges: [],
          links: [],
        },
      ])
      .filter((items) => items[0].text);
  }

  function normalizeMaxContentImages(value, fallback) {
    if (value == null || value === "") return fallback;
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(0, Math.floor(number));
  }

  function contentImagesForPlan(draft, options = {}) {
    const sourceImages = Array.isArray(options.contentImages)
      ? options.contentImages
      : draft?.contentImages || [];
    const maxContentImages = normalizeMaxContentImages(
      options.maxContentImages,
      sourceImages.length,
    );

    return {
      selectedImages: sourceImages.slice(0, maxContentImages),
      skippedImages: sourceImages.slice(maxContentImages),
      maxContentImages,
      totalContentImages: sourceImages.length,
    };
  }

  function bodyHtmlWithMarkers(draft, options = {}) {
    const blocks = String(draft?.bodyHtml || "").split("\n");
    const { selectedImages } = contentImagesForPlan(draft, options);
    const { markersByBlock } = groupMarkersByBlock(selectedImages);

    return blocks
      .flatMap((block, index) => {
        const markers = markersByBlock.get(index) || [];
        return [
          block,
          ...markers.map((marker) => `<p><strong>${marker}</strong></p>`),
        ];
      })
      .join("\n");
  }

  function draftBlocksWithMarkers(draft, options = {}) {
    const sourceBlocks = sourceBlocksFromDraft(draft);
    const { selectedImages } = contentImagesForPlan(draft, options);
    const { markersByBlock } = groupMarkersByBlock(selectedImages);

    return sourceBlocks.flatMap((sourceBlock, index) => {
      const markers = markersByBlock.get(index) || [];
      return [
        ...sourceBlock,
        ...markers.map((marker) => ({
          type: "unstyled",
          text: marker,
          inlineStyleRanges: [],
          links: [],
        })),
      ];
    });
  }

  function plainTextWithMarkers(draft, options = {}) {
    const lines = String(draft?.plainText || "")
      .split(/\n{2,}/)
      .map((line) => line.trim())
      .filter(Boolean);
    const { selectedImages } = contentImagesForPlan(draft, options);
    const { markersByBlock } = groupMarkersByBlock(selectedImages);

    return lines
      .flatMap((line, index) => {
        const markers = markersByBlock.get(index) || [];
        return [line, ...markers];
      })
      .join("\n\n");
  }

  function buildXImportPlan(draft, options = {}) {
    const { selectedImages, skippedImages, maxContentImages, totalContentImages } =
      contentImagesForPlan(draft, options);
    const { images } = groupMarkersByBlock(selectedImages);
    return {
      html: bodyHtmlWithMarkers(draft, options),
      plain: plainTextWithMarkers(draft, options),
      blocks: draftBlocksWithMarkers(draft, options),
      markerPrefix: MARKER_PREFIX,
      images,
      skippedImages,
      maxContentImages,
      totalContentImages,
    };
  }

  global.XAPImportPlan = {
    MARKER_PREFIX,
    markerForImage,
    contentImagesForPlan,
    bodyHtmlWithMarkers,
    plainTextWithMarkers,
    draftBlocksWithMarkers,
    buildXImportPlan,
  };
})(globalThis);
