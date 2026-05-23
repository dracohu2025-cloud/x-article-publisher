import { spawn } from "node:child_process";

function killProcessGroup(child) {
  if (!child.pid) return;

  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGTERM");
      setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }, 2_000).unref?.();
      return;
    } catch {}
  }

  child.kill("SIGTERM");
}

export async function runLarkCli(args, options = {}) {
  const maxBuffer = options.maxBuffer ?? 64 * 1024 * 1024;
  const timeout = options.timeout ?? 120_000;

  return new Promise((resolve, reject) => {
    const child = spawn("lark-cli", args, {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let bufferExceeded = false;

    const timer =
      timeout > 0
        ? setTimeout(() => {
            timedOut = true;
            killProcessGroup(child);
          }, timeout)
        : null;

    function appendOutput(kind, chunk) {
      if (bufferExceeded) return;
      const text = chunk.toString("utf8");
      if (kind === "stdout") {
        stdoutBytes += chunk.length;
        stdout += text;
      } else {
        stderrBytes += chunk.length;
        stderr += text;
      }

      if (stdoutBytes + stderrBytes > maxBuffer) {
        bufferExceeded = true;
        killProcessGroup(child);
      }
    }

    child.stdout.on("data", (chunk) => appendOutput("stdout", chunk));
    child.stderr.on("data", (chunk) => appendOutput("stderr", chunk));

    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      if (code === 0 && !bufferExceeded) {
        resolve(stdout);
        return;
      }

      const details = [
        timedOut ? `Command timed out after ${timeout}ms` : "",
        bufferExceeded ? `Command output exceeded ${maxBuffer} bytes` : "",
        code !== null ? `Command exited with code ${code}` : "",
        signal ? `Command exited with signal ${signal}` : "",
      ].filter(Boolean);
      const reason = details.length ? `\n${details.join("\n")}` : "";
      const stderrText = stderr ? `\n${stderr}` : "";
      const stdoutText = stdout ? `\n${stdout}` : "";
      reject(
        new Error(
          `lark-cli 执行失败: lark-cli ${args.join(" ")}${reason}${stderrText}${stdoutText}`,
        ),
      );
    });
  });
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
