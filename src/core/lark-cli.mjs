import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function runLarkCli(args, options = {}) {
  try {
    const { stdout } = await execFileAsync("lark-cli", args, {
      cwd: options.cwd,
      maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
      timeout: options.timeout ?? 120_000,
    });
    return stdout;
  } catch (error) {
    const stderr = error.stderr ? `\n${error.stderr}` : "";
    const reason = error.message ? `\n${error.message}` : "";
    throw new Error(`lark-cli 执行失败: lark-cli ${args.join(" ")}${reason}${stderr}`);
  }
}

export async function fetchLarkDoc(docUrl) {
  const stdout = await runLarkCli([
    "docs",
    "+fetch",
    "--doc",
    docUrl,
    "--format",
    "json",
  ]);

  const result = JSON.parse(stdout);
  if (!result.ok) {
    throw new Error(result.message || "飞书文档读取失败");
  }

  return {
    docId: result.data.doc_id,
    title: result.data.title,
    markdown: result.data.markdown,
    identity: result.identity,
    logId: result.data.log_id,
    totalLength: result.data.total_length,
  };
}

export async function downloadLarkMedia(token, target, options = {}) {
  const cwd = typeof target === "string" ? undefined : target.cwd;
  const output = typeof target === "string" ? target : target.output;
  await runLarkCli([
    "docs",
    "+media-download",
    "--token",
    token,
    "--output",
    output,
    "--overwrite",
  ], {
    cwd,
    timeout: options.timeout,
  });
}
