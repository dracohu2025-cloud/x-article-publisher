#!/usr/bin/env node

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { prepareFeishuDoc } from "../core/prepare-feishu-doc.mjs";

const port = Number(process.env.XAP_HELPER_PORT || 49231);
const draftsRoot = path.resolve(process.cwd(), ".xap/drafts");
const statusPath = path.resolve(process.cwd(), ".xap/status.json");
let requestSeq = 0;

async function writeStatus(status) {
  await fs.promises.mkdir(path.dirname(statusPath), { recursive: true });
  await fs.promises.writeFile(
    statusPath,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        ...status,
      },
      null,
      2,
    ),
    "utf8",
  );
}

async function readStatus() {
  try {
    return JSON.parse(await fs.promises.readFile(statusPath, "utf8"));
  } catch {
    return {
      state: "idle",
      updatedAt: null,
    };
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath) {
  const contentTypes = {
    ".gif": "image/gif",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  };
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    "content-type": contentTypes[ext] || "application/octet-stream",
    "access-control-allow-origin": "*",
  });
  fs.createReadStream(filePath).pipe(res);
}

function resolveDraftAsset(rawPath) {
  if (!rawPath) {
    throw new Error("缺少图片路径");
  }

  const filePath = path.resolve(rawPath);
  const isInsideDrafts =
    filePath === draftsRoot || filePath.startsWith(`${draftsRoot}${path.sep}`);
  if (!isInsideDrafts) {
    throw new Error("只允许读取 .xap/drafts 下的图片");
  }
  return filePath;
}

function resolveDraftJson(rawPath) {
  const filePath = resolveDraftAsset(rawPath);
  if (path.basename(filePath) !== "draft.json") {
    throw new Error("只允许读取 draft.json");
  }
  return filePath;
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  return body ? JSON.parse(body) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");

  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  try {
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, service: "xap-helper" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/status") {
      sendJson(res, 200, { ok: true, status: await readStatus() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/asset") {
      const filePath = resolveDraftAsset(url.searchParams.get("path"));
      sendFile(res, filePath);
      return;
    }

    if (req.method === "GET" && url.pathname === "/draft") {
      const draftPath = url.searchParams.get("path");
      const filePath = resolveDraftJson(draftPath);
      const draft = JSON.parse(await fs.promises.readFile(filePath, "utf8"));
      const draftDir = path.dirname(filePath);
      sendJson(res, 200, {
        ok: true,
        draftDir,
        draftPath: filePath,
        bodyHtmlPath: path.join(draftDir, "body.html"),
        draft,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/prepare") {
      const requestId = String(++requestSeq).padStart(3, "0");
      console.log(`[${requestId}] prepare start`);
      const body = await readJson(req);
      await writeStatus({
        state: "running",
        requestId,
        docUrl: body.docUrl,
        phase: "fetching",
        message: "正在读取飞书文档...",
      });
      const result = await prepareFeishuDoc({
        docUrl: body.docUrl,
        outDir: body.outDir,
        downloadMedia: body.downloadMedia !== false,
        mediaTimeoutMs: body.mediaTimeoutMs,
        onProgress: async (event) => {
          if (event.type === "media-download-start") {
            console.log(
              `[${requestId}] media ${event.index}/${event.total} start ${event.token}`,
            );
            await writeStatus({
              state: "running",
              requestId,
              docUrl: body.docUrl,
              phase: "media",
              current: event.index,
              total: event.total,
              message: `正在下载图片 ${event.index}/${event.total}`,
            });
          }
          if (event.type === "media-download-done") {
            console.log(
              `[${requestId}] media ${event.index}/${event.total} done ${event.path}`,
            );
            await writeStatus({
              state: "running",
              requestId,
              docUrl: body.docUrl,
              phase: "media",
              current: event.index,
              total: event.total,
              lastPath: event.path,
              message: `已下载图片 ${event.index}/${event.total}`,
            });
          }
          if (event.type === "media-download-error") {
            console.log(
              `[${requestId}] media ${event.index}/${event.total} error ${event.error}`,
            );
            await writeStatus({
              state: "running",
              requestId,
              docUrl: body.docUrl,
              phase: "media",
              current: event.index,
              total: event.total,
              error: event.error,
              message: `图片 ${event.index}/${event.total} 下载失败，继续处理`,
            });
          }
        },
      });
      console.log(`[${requestId}] prepare done ${result.draftPath}`);
      await writeStatus({
        state: "done",
        requestId,
        docUrl: body.docUrl,
        phase: "done",
        message: "草稿已生成",
        draftDir: result.draftDir,
        draftPath: result.draftPath,
        title: result.draft.title,
        stats: result.draft.stats,
        contentImageCount: result.draft.contentImages.length,
        warnings: result.draft.warnings,
      });
      sendJson(res, 200, {
        ok: true,
        draftDir: result.draftDir,
        draftPath: result.draftPath,
        bodyHtmlPath: result.bodyHtmlPath,
        draft: result.draft,
      });
      return;
    }

    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    console.error(`request failed: ${error.message}`);
    await writeStatus({
      state: "error",
      phase: "error",
      message: error.message,
    });
    sendJson(res, 500, { ok: false, error: error.message });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`xap-helper listening on http://127.0.0.1:${port}`);
});
