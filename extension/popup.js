const helperBase = "http://127.0.0.1:49231";

const els = {
  openX: document.querySelector("#openX"),
  checkHelper: document.querySelector("#checkHelper"),
  status: document.querySelector("#status"),
  latest: document.querySelector("#latest"),
  latestTitle: document.querySelector("#latestTitle"),
  latestMeta: document.querySelector("#latestMeta"),
};

function setStatus(message) {
  els.status.textContent = message;
  const value = String(message || "");
  if (/失败|无法|错误|unknown|error/i.test(value)) {
    els.status.dataset.tone = "error";
  } else if (/正在|处理中|生成|读取/i.test(value)) {
    els.status.dataset.tone = "warning";
  } else {
    delete els.status.dataset.tone;
  }
}

function renderLatestDraft(payload) {
  if (!payload?.draft) {
    els.latest.hidden = true;
    return;
  }

  els.latest.hidden = false;
  els.latestTitle.textContent = payload.draft.title;
  els.latestMeta.textContent = `${payload.draft.stats.blockCount} 个文本块，${payload.draft.stats.imageCount} 张图片`;
}

function helperStatusText(status) {
  if (!status || status.state === "idle") return "helper 已连接，暂无运行中的任务。";
  if (status.state === "running") {
    const progress =
      status.total && status.current != null ? ` ${status.current}/${status.total}` : "";
    return `${status.message || "helper 正在处理草稿..."}${progress}`;
  }
  if (status.state === "done") {
    return `最近一次草稿已生成：${status.title || "未命名"}`;
  }
  if (status.state === "error") {
    return `最近一次生成失败：${status.message || "未知错误"}`;
  }
  return "helper 状态未知。";
}

async function refreshHelperStatus() {
  try {
    const res = await fetch(`${helperBase}/status`);
    const payload = await res.json();
    if (!payload.ok) throw new Error(payload.error || "读取 helper 状态失败");
    setStatus(helperStatusText(payload.status));
  } catch (error) {
    setStatus(`无法连接 helper：${error.message}`);
  }
}

els.openX.addEventListener("click", async () => {
  await chrome.tabs.create({ url: "https://x.com/compose/articles" });
});

els.checkHelper.addEventListener("click", refreshHelperStatus);

chrome.storage.local.get("latestDraft", ({ latestDraft }) => {
  renderLatestDraft(latestDraft);
  refreshHelperStatus();
});
