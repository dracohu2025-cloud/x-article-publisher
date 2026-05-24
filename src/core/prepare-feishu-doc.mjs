import fs from "node:fs/promises";
import path from "node:path";
import { fetchLarkDoc, downloadLarkMedia } from "./lark-cli.mjs";
import { normalizeLarkMarkdown } from "./normalize-lark-markdown.mjs";

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "untitled";
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

async function findDownloadedFile(outputBase) {
  const dir = path.dirname(outputBase);
  const base = path.basename(outputBase);
  const files = await fs.readdir(dir);
  const match = files.find((file) => file === base || file.startsWith(`${base}.`));
  if (!match) {
    throw new Error(`媒体下载完成但未找到输出文件: ${outputBase}`);
  }
  return path.join(dir, match);
}

function normalizeMaxAttempts(value) {
  const attempts = Number(value);
  if (!Number.isFinite(attempts)) return 3;
  return Math.max(1, Math.floor(attempts));
}

function retryDelay(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function downloadImages(images, assetsDir, options = {}) {
  const resolved = [];
  const downloadMediaFn = options.downloadMediaFn || downloadLarkMedia;
  const maxAttempts = normalizeMaxAttempts(options.maxAttempts);
  const retryDelayMs = Number(options.retryDelayMs ?? 750);
  await fs.mkdir(assetsDir, { recursive: true });

  for (const [index, image] of images.entries()) {
    const outputBase = path.join(
      assetsDir,
      `image-${String(index + 1).padStart(2, "0")}`,
    );

    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      options.onProgress?.({
        type: "media-download-start",
        index: index + 1,
        total: images.length,
        token: image.token,
        attempt,
        maxAttempts,
      });

      try {
        await downloadMediaFn(
          image.token,
          {
            cwd: assetsDir,
            output: path.basename(outputBase),
          },
          {
            timeout: options.timeoutMs,
          },
        );
        const filePath = await findDownloadedFile(outputBase);
        resolved.push({
          ...image,
          path: filePath,
          relativePath: path.relative(path.dirname(assetsDir), filePath),
          ...(lastError
            ? {
                downloadWarning: `前 ${attempt - 1} 次下载失败后重试成功: ${
                  lastError.message
                }`,
              }
            : {}),
        });
        options.onProgress?.({
          type: "media-download-done",
          index: index + 1,
          total: images.length,
          token: image.token,
          path: filePath,
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        try {
          const filePath = await findDownloadedFile(outputBase);
          resolved.push({
            ...image,
            path: filePath,
            relativePath: path.relative(path.dirname(assetsDir), filePath),
            downloadWarning: error.message,
          });
          options.onProgress?.({
            type: "media-download-done",
            index: index + 1,
            total: images.length,
            token: image.token,
            path: filePath,
          });
          lastError = null;
          break;
        } catch {}

        options.onProgress?.({
          type: "media-download-error",
          index: index + 1,
          total: images.length,
          token: image.token,
          attempt,
          maxAttempts,
          error: error.message,
        });
        if (attempt < maxAttempts) {
          await retryDelay(retryDelayMs * attempt);
        }
      }
    }

    if (lastError) {
      resolved.push({
        ...image,
        downloadError: lastError.message,
      });
    }
  }

  return resolved;
}

function tablePreview(rows) {
  return rows
    .flat()
    .map((cell) => String(cell || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" / ")
    .slice(0, 80);
}

function buildTableImages(blocks = []) {
  return blocks
    .map((block, blockIndex) => ({ block, blockIndex }))
    .filter(({ block }) => block?.type === "table" && Array.isArray(block.rows))
    .map(({ block, blockIndex }) => ({
      kind: "table",
      token: `table-${String(blockIndex + 1).padStart(2, "0")}`,
      blockIndex,
      afterText: tablePreview(block.rows),
      table: {
        rows: block.rows,
        attrs: block.attrs || {},
      },
    }));
}

export function buildDraftImages(images, blocks = []) {
  const bodyImages = images.map((image) => ({ ...image, kind: image.kind }));
  const tableImages = buildTableImages(blocks);
  const contentImages = [...bodyImages, ...tableImages].sort((left, right) => {
    const leftBlock = Number(left.blockIndex || 0);
    const rightBlock = Number(right.blockIndex || 0);
    if (leftBlock !== rightBlock) return leftBlock - rightBlock;
    if (left.kind === "table" && right.kind !== "table") return -1;
    if (left.kind !== "table" && right.kind === "table") return 1;
    return 0;
  });

  return {
    coverImage: null,
    contentImages: contentImages.map((image, index) => ({
      ...image,
      marker: `[XAP-IMG-${String(index + 1).padStart(2, "0")}]`,
    })),
  };
}

export async function prepareFeishuDoc({
  docUrl,
  outDir = ".xap/drafts",
  downloadMedia = true,
  mediaTimeoutMs = 45_000,
  mediaMaxAttempts = 3,
  onProgress,
} = {}) {
  if (!docUrl) {
    throw new Error("缺少必填参数 docUrl");
  }

  const source = await fetchLarkDoc(docUrl);
  const normalized = normalizeLarkMarkdown(source);
  const draftDir = path.resolve(
    outDir,
    `${slugify(source.title)}-${timestamp()}`,
  );
  const assetsDir = path.join(draftDir, "assets");

  await fs.mkdir(draftDir, { recursive: true });

  let downloadedImages = normalized.images;
  if (downloadMedia && normalized.images.length > 0) {
    downloadedImages = await downloadImages(normalized.images, assetsDir, {
      timeoutMs: mediaTimeoutMs,
      maxAttempts: mediaMaxAttempts,
      onProgress,
    });
  }

  const { coverImage, contentImages } = buildDraftImages(downloadedImages, normalized.blocks);
  const tableImageCount = contentImages.filter((image) => image.kind === "table").length;
  const mediaWarnings = downloadedImages
    .flatMap((image, index) =>
      image.downloadError
        ? [`第 ${index + 1} 张图片下载失败，已保留 token: ${image.token}`]
        : [],
    );

  const draft = {
    schemaVersion: 1,
    source: {
      type: "feishu-docx",
      url: docUrl,
      docId: source.docId,
      identity: source.identity,
      logId: source.logId,
    },
    title: normalized.title,
    bodyHtml: normalized.bodyHtml,
    plainText: normalized.plainText,
    blocks: normalized.blocks,
    coverImage,
    contentImages,
    warnings: [...normalized.warnings, ...mediaWarnings],
    stats: {
      ...normalized.stats,
      imageCount: contentImages.length,
      sourceImageCount: normalized.stats.imageCount,
      tableImageCount,
    },
    generatedAt: new Date().toISOString(),
  };

  await fs.writeFile(
    path.join(draftDir, "source.md"),
    source.markdown,
    "utf8",
  );
  await fs.writeFile(
    path.join(draftDir, "body.html"),
    normalized.bodyHtml,
    "utf8",
  );
  await fs.writeFile(
    path.join(draftDir, "draft.json"),
    JSON.stringify(draft, null, 2),
    "utf8",
  );

  return {
    draftDir,
    draftPath: path.join(draftDir, "draft.json"),
    bodyHtmlPath: path.join(draftDir, "body.html"),
    draft,
  };
}
