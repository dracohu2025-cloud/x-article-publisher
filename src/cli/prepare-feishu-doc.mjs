#!/usr/bin/env node

import { prepareFeishuDoc } from "../core/prepare-feishu-doc.mjs";

function parseArgs(argv) {
  const args = {
    outDir: ".xap/drafts",
    downloadMedia: true,
    mediaTimeoutMs: 45_000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--doc") {
      args.docUrl = argv[++index];
    } else if (arg === "--out") {
      args.outDir = argv[++index];
    } else if (arg === "--skip-media") {
      args.downloadMedia = false;
    } else if (arg === "--media-timeout-ms") {
      args.mediaTimeoutMs = Number(argv[++index]);
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`未知参数: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  npm run prepare:feishu -- --doc "<feishu-doc-url>" [--out ".xap/drafts"] [--skip-media]

Options:
  --doc          飞书文档 URL 或 docx token
  --out          草稿输出目录，默认 .xap/drafts
  --skip-media   只转换文本，不下载图片
  --media-timeout-ms  单张图片下载超时，默认 45000
`);
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.docUrl) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const result = await prepareFeishuDoc({
    ...args,
    onProgress(event) {
      if (event.type === "media-download-start") {
        console.error(`下载图片 ${event.index}/${event.total}: ${event.token}`);
      }
      if (event.type === "media-download-error") {
        console.error(`图片 ${event.index}/${event.total} 下载失败: ${event.error}`);
      }
    },
  });
  console.log(
    JSON.stringify(
      {
        ok: true,
        draftDir: result.draftDir,
        draftPath: result.draftPath,
        bodyHtmlPath: result.bodyHtmlPath,
        title: result.draft.title,
        stats: result.draft.stats,
        warnings: result.draft.warnings,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error.message,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
