const helperBase = "http://127.0.0.1:49231";
const XAP_CONTENT_VERSION = "context-safe-storage-v2";
const X_ARTICLE_MAX_IMAGES = 26;

const state = {
  draft: null,
  draftPath: null,
  images: [],
  collapsed: false,
  preparing: false,
  importing: false,
};

const els = {};
let statusPollId = null;

function assetUrl(image) {
  return `${helperBase}/asset?path=${encodeURIComponent(image.path)}`;
}

function setStatus(message) {
  if (els.status) {
    els.status.textContent = message;
  }
}

function uploadableContentImages(draft) {
  const images = draft?.coverImage
    ? [draft.coverImage, ...(draft?.contentImages || [])]
    : draft?.contentImages || [];
  return images
    .map((image, index) => ({
      ...image,
      marker: image?.marker || `[XAP-IMG-${String(index + 1).padStart(2, "0")}]`,
    }))
    .filter((image) => image.path);
}

function imageLimitInfo(draft) {
  const allImages = (draft?.coverImage
    ? [draft.coverImage, ...(draft?.contentImages || [])]
    : draft?.contentImages || []
  ).map((image, index) => ({
    ...image,
    marker: image?.marker || `[XAP-IMG-${String(index + 1).padStart(2, "0")}]`,
  }));
  const uploadableImages = uploadableContentImages(draft);
  const unavailableImages = allImages.filter((image) => !image.path);
  const coverSlots = 0;
  const maxContentImages = Math.max(0, X_ARTICLE_MAX_IMAGES - coverSlots);
  const selectedImages = uploadableImages.slice(0, maxContentImages);
  const limitSkippedImages = uploadableImages.slice(maxContentImages);
  const skippedImages = [...unavailableImages, ...limitSkippedImages];

  return {
    coverSlots,
    maxArticleImages: X_ARTICLE_MAX_IMAGES,
    maxContentImages,
    totalContentImages: allImages.length,
    uploadableCount: uploadableImages.length,
    unavailableImages,
    unavailableCount: unavailableImages.length,
    limitSkippedImages,
    limitSkippedCount: limitSkippedImages.length,
    selectedImages,
    skippedImages,
    selectedCount: selectedImages.length,
    skippedCount: skippedImages.length,
  };
}

function draftCounterText(draft) {
  if (!draft) return "等待生成草稿";

  const limit = imageLimitInfo(draft);
  const imageCount = draft?.stats?.imageCount ?? limit.totalContentImages;
  const blockCount = draft?.stats?.blockCount ?? 0;
  const unavailableSuffix =
    limit.unavailableCount > 0 ? `，下载失败 ${limit.unavailableCount} 张` : "";
  const limitSuffix =
    limit.limitSkippedCount > 0 ? `，超限跳过 ${limit.limitSkippedCount} 张` : "";
  const suffix =
    limit.skippedCount > 0
      ? `，将导入 ${limit.selectedCount} 张${unavailableSuffix}${limitSuffix}`
      : "";
  return `${blockCount} 个文本块，${imageCount} 张图片，正文图 ${limit.selectedCount}/${limit.totalContentImages} 张${suffix}`;
}

function draftHintText(draft) {
  if (!draft) {
    return "在这里粘贴飞书链接并生成草稿，不需要再回到浏览器插件栏。";
  }

  const limit = imageLimitInfo(draft);
  if (limit.unavailableCount > 0) {
    return `有 ${limit.unavailableCount} 张图片没有下载成功，自动导入会跳过这些图片；可重新生成草稿或手动补图。`;
  }
  if (limit.limitSkippedCount > 0) {
    return `受 X Articles 总图数 ${limit.maxArticleImages} 张限制，超出部分会跳过；图片多的文章建议拆篇。`;
  }
  return "主流程：点击自动导入正文和图片，检查结果后再发布。";
}

function draftGeneratedStatus(draft) {
  const limit = imageLimitInfo(draft);
  const base = `草稿已生成：${draft.stats.blockCount} 个文本块，${limit.totalContentImages} 张正文图，可导入 ${limit.selectedCount} 张。`;
  if (limit.skippedCount === 0) return base;
  const unavailableText =
    limit.unavailableCount > 0 ? `下载失败 ${limit.unavailableCount} 张` : "";
  const limitText =
    limit.limitSkippedCount > 0 ? `超限跳过 ${limit.limitSkippedCount} 张` : "";
  return `${base}${[unavailableText, limitText].filter(Boolean).join("，")}。`;
}

function imageLimitStatusSuffix(draft) {
  const limit = imageLimitInfo(draft);
  if (limit.skippedCount === 0) return "";
  const unavailableText =
    limit.unavailableCount > 0 ? `下载失败 ${limit.unavailableCount} 张` : "";
  const limitText =
    limit.limitSkippedCount > 0 ? `超限跳过 ${limit.limitSkippedCount} 张` : "";
  return `；正文将导入 ${limit.selectedCount}/${limit.totalContentImages} 张，${[
    unavailableText,
    limitText,
  ].filter(Boolean).join("，")}`;
}

function nextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

async function withButtonFeedback(button, busyText, action) {
  const originalText = button.textContent;
  button.disabled = true;
  button.dataset.busy = "true";
  button.textContent = busyText;
  await nextPaint();

  try {
    return await action();
  } finally {
    button.disabled = false;
    delete button.dataset.busy;
    button.textContent = originalText;
  }
}

async function markButtonDone(button, text) {
  const originalText = button.textContent;
  button.textContent = text;
  await new Promise((resolve) => setTimeout(resolve, 900));
  button.textContent = originalText;
}

function injectStyles() {
  if (document.querySelector("#xap-style")) return;

  const style = document.createElement("style");
  style.id = "xap-style";
  style.textContent = `
    #xap-panel {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      width: 360px;
      max-width: calc(100vw - 32px);
      color: #0f1419;
      background: #fff;
      border: 1px solid #cfd9de;
      border-radius: 8px;
      box-shadow: 0 10px 28px rgba(15, 20, 25, 0.2);
      font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    #xap-panel[data-collapsed="true"] .xap-body {
      display: none;
    }

    #xap-panel [hidden] {
      display: none !important;
    }

    .xap-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid #eff3f4;
      font-weight: 700;
    }

    .xap-body {
      display: grid;
      gap: 10px;
      padding: 12px;
    }

    .xap-field {
      display: grid;
      gap: 6px;
    }

    .xap-field label {
      font-weight: 650;
    }

    #xap-doc-url {
      box-sizing: border-box;
      width: 100%;
      min-height: 72px;
      resize: vertical;
      border: 1px solid #cfd9de;
      border-radius: 6px;
      padding: 8px;
      color: #0f1419;
      background: #fff;
      font: inherit;
    }

    #xap-doc-url:disabled {
      opacity: 0.72;
      cursor: not-allowed;
    }

    .xap-title,
    .xap-hint,
    .xap-status {
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .xap-title {
      font-weight: 700;
      white-space: nowrap;
    }

    .xap-summary {
      display: grid;
      gap: 4px;
    }

    .xap-counter {
      color: #536471;
    }

    .xap-hint {
      display: -webkit-box;
      color: #536471;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    .xap-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    #xap-panel button {
      border: 0;
      border-radius: 6px;
      padding: 7px 9px;
      color: #0f1419;
      background: #eff3f4;
      font: inherit;
      font-weight: 650;
      cursor: pointer;
    }

    #xap-panel button.xap-primary {
      color: #fff;
      background: #1d9bf0;
    }

    #xap-panel button:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }

    #xap-panel button[data-busy="true"] {
      cursor: progress;
    }

    #xap-panel button[data-busy="true"]::after {
      content: "";
      display: inline-block;
      width: 10px;
      height: 10px;
      margin-left: 6px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      vertical-align: -1px;
      animation: xap-spin 0.8s linear infinite;
    }

    @keyframes xap-spin {
      to {
        transform: rotate(360deg);
      }
    }

    .xap-status {
      min-height: 18px;
      color: #536471;
      word-break: break-word;
    }
  `;
  document.documentElement.append(style);
}

function createPanel() {
  if (document.querySelector("#xap-panel")) return;
  injectStyles();

  const panel = document.createElement("section");
  panel.id = "xap-panel";
  panel.dataset.collapsed = "false";
  panel.innerHTML = `
    <div class="xap-header">
      <span>XAP 导入</span>
      <button type="button" data-action="toggle">收起</button>
    </div>
    <div class="xap-body">
      <div class="xap-field" data-section="input">
        <label for="xap-doc-url">飞书文档链接</label>
        <textarea id="xap-doc-url" rows="3" placeholder="https://*.feishu.cn/docx/..."></textarea>
      </div>
      <div class="xap-actions" data-section="prepare-actions">
        <button type="button" class="xap-primary" data-action="prepare">生成草稿</button>
      </div>
      <div class="xap-summary" data-section="summary">
        <div class="xap-title" data-role="title">未加载草稿</div>
        <div class="xap-counter" data-role="counter">0/0</div>
      </div>
      <div class="xap-hint" data-role="hint" data-section="hint"></div>
      <div class="xap-actions" data-section="draft-actions">
        <button type="button" data-action="copy-title">复制标题</button>
        <button type="button" class="xap-primary" data-action="import">自动导入正文+图片</button>
        <button type="button" data-action="reload">刷新草稿</button>
        <button type="button" data-action="clear-draft">清空草稿</button>
      </div>
      <div class="xap-status" data-role="status"></div>
    </div>
  `;

  document.documentElement.append(panel);
  panel.dataset.contentVersion = XAP_CONTENT_VERSION;
  els.panel = panel;
  els.docUrl = panel.querySelector("#xap-doc-url");
  els.prepare = panel.querySelector('[data-action="prepare"]');
  els.copyTitle = panel.querySelector('[data-action="copy-title"]');
  els.title = panel.querySelector('[data-role="title"]');
  els.counter = panel.querySelector('[data-role="counter"]');
  els.hint = panel.querySelector('[data-role="hint"]');
  els.status = panel.querySelector('[data-role="status"]');
  els.import = panel.querySelector('[data-action="import"]');
  els.reload = panel.querySelector('[data-action="reload"]');
  els.clearDraft = panel.querySelector('[data-action="clear-draft"]');
  els.toggle = panel.querySelector('[data-action="toggle"]');
  els.sections = {
    input: panel.querySelector('[data-section="input"]'),
    prepareActions: panel.querySelector('[data-section="prepare-actions"]'),
    summary: panel.querySelector('[data-section="summary"]'),
    hint: panel.querySelector('[data-section="hint"]'),
    draftActions: panel.querySelector('[data-section="draft-actions"]'),
  };

  panel.addEventListener("click", async (event) => {
    const action = event.target?.dataset?.action;
    if (!action) return;

    if (action === "toggle") {
      state.collapsed = !state.collapsed;
      panel.dataset.collapsed = String(state.collapsed);
      els.toggle.textContent = state.collapsed ? "展开" : "收起";
      return;
    }

    if (action === "prepare") {
      await prepareDraft();
      return;
    }

    if (action === "copy-title") {
      await copyTitle();
      return;
    }

    if (action === "reload") {
      await refreshDraft();
      return;
    }

    if (action === "clear-draft") {
      await clearDraft();
      return;
    }

    if (action === "import") {
      await importBodyAndImages();
    }
  });
}

function setVisible(element, visible) {
  if (element) {
    element.hidden = !visible;
  }
}

function setButtonView(button, buttonView) {
  if (!button || !buttonView) return;
  setVisible(button, buttonView.visible);
  button.disabled = !buttonView.enabled;
}

function render() {
  createPanel();

  const view = globalThis.XAPPanelState.buildPanelView(state);

  els.title.textContent = state.draft?.title || "未加载草稿";
  els.counter.textContent = draftCounterText(state.draft);
  els.hint.textContent = draftHintText(state.draft);
  els.import.textContent = state.importing ? "导入中" : "自动导入正文+图片";
  els.docUrl.disabled = state.preparing || state.importing;

  if (state.importing) {
    els.import.dataset.busy = "true";
  } else {
    delete els.import.dataset.busy;
  }

  setVisible(els.sections.input, view.sections.input);
  setVisible(els.sections.prepareActions, view.sections.prepareActions);
  setVisible(els.sections.summary, view.sections.summary);
  setVisible(els.sections.hint, view.sections.hint);
  setVisible(els.sections.draftActions, view.sections.draftActions);

  setButtonView(els.prepare, view.buttons.prepare);
  setButtonView(els.copyTitle, view.buttons.copyTitle);
  setButtonView(els.import, view.buttons.import);
  setButtonView(els.reload, view.buttons.reload);
  setButtonView(els.clearDraft, view.buttons.clearDraft);

  if (state.images.length > 0 && !els.status.textContent) {
    setStatus("准备就绪。点击“自动导入正文+图片”开始。");
  }
}

function applyDraftPayload(payload) {
  state.draft = payload?.draft || null;
  state.draftPath = payload?.draftPath || null;
  state.images = uploadableContentImages(state.draft);
  render();
}

function isExtensionContextInvalidated(error) {
  return (
    globalThis.XAPExtensionContext?.isExtensionContextInvalidated?.(error) ||
    /Extension context invalidated/i.test(String(error?.message || error || ""))
  );
}

function extensionReloadMessage() {
  return (
    globalThis.XAPExtensionContext?.extensionReloadMessage?.() ||
    "插件刚重新加载，当前页面还在使用旧脚本。请刷新 X Articles 页面后点击“刷新草稿”。"
  );
}

async function readLocalStorage(keys) {
  try {
    return await chrome.storage.local.get(keys);
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      setStatus(extensionReloadMessage());
      return { extensionContextInvalidated: true };
    }
    throw error;
  }
}

async function writeLocalStorage(values) {
  try {
    await chrome.storage.local.set(values);
    return true;
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      setStatus(extensionReloadMessage());
      return false;
    }
    throw error;
  }
}

async function removeLocalStorage(keys) {
  try {
    await chrome.storage.local.remove(keys);
    return true;
  } catch (error) {
    if (isExtensionContextInvalidated(error)) {
      setStatus(extensionReloadMessage());
      return false;
    }
    throw error;
  }
}

async function loadStoredDraft() {
  createPanel();
  const result = await readLocalStorage(["latestDraft", "latestDocUrl"]);
  if (result.extensionContextInvalidated) {
    return false;
  }
  if (result.latestDocUrl && els.docUrl && !els.docUrl.value.trim()) {
    els.docUrl.value = result.latestDocUrl;
  }
  const draft = result.latestDraft?.draft;
  if (!draft) {
    applyDraftPayload(null);
    setStatus("没有本地草稿，请粘贴飞书链接后生成。");
    return false;
  }

  applyDraftPayload(result.latestDraft);
  setStatus(`已加载本地草稿：${draft.title}${imageLimitStatusSuffix(draft)}`);
  return true;
}

async function loadDraftFromHelper(draftPath) {
  const res = await fetch(`${helperBase}/draft?path=${encodeURIComponent(draftPath)}`);
  const payload = await res.json();
  if (!payload.ok) {
    throw new Error(payload.error || "读取草稿失败");
  }

  applyDraftPayload(payload);
  const stored = await writeLocalStorage({ latestDraft: payload });
  const status = `已载入最近草稿：${payload.draft.title}${imageLimitStatusSuffix(payload.draft)}`;
  setStatus(stored ? status : `${status}。${extensionReloadMessage()}`);
  return payload;
}

function formatHelperProgress(status) {
  const progress =
    status.total && status.current != null ? ` ${status.current}/${status.total}` : "";
  return `${status.message || "helper 正在处理草稿..."}${progress}`;
}

async function refreshDraft() {
  createPanel();
  setStatus("正在读取最近草稿...");

  try {
    const res = await fetch(`${helperBase}/status`);
    const payload = await res.json();
    if (!payload.ok) throw new Error(payload.error || "读取 helper 状态失败");

    const helperStatus = payload.status;
    if (helperStatus?.state === "done" && helperStatus.draftPath) {
      await loadDraftFromHelper(helperStatus.draftPath);
      return;
    }
    if (helperStatus?.state === "running") {
      setStatus(formatHelperProgress(helperStatus));
      return;
    }
    if (helperStatus?.state === "error") {
      setStatus(`最近一次生成失败：${helperStatus.message || "未知错误"}`);
      return;
    }

    await loadStoredDraft();
  } catch (error) {
    await loadStoredDraft();
    setStatus(`无法连接 helper：${error.message}`);
  }
}

async function clearDraft() {
  if (state.preparing || state.importing) return;

  stopStatusPolling();
  const removed = await removeLocalStorage(["latestDraft", "latestDocUrl"]);
  try {
    await fetch(`${helperBase}/clear`, { method: "POST" });
  } catch {}

  state.draft = null;
  state.draftPath = null;
  state.images = [];
  if (els.docUrl) els.docUrl.value = "";
  render();
  setStatus(removed ? "" : extensionReloadMessage());
}

function stopStatusPolling() {
  if (statusPollId) {
    clearInterval(statusPollId);
    statusPollId = null;
  }
}

function startStatusPolling() {
  stopStatusPolling();
  statusPollId = setInterval(async () => {
    try {
      const res = await fetch(`${helperBase}/status`);
      const payload = await res.json();
      if (!payload.ok) return;

      const helperStatus = payload.status;
      if (helperStatus?.state === "running") {
        setStatus(formatHelperProgress(helperStatus));
        return;
      }
      if (helperStatus?.state === "done" && helperStatus.draftPath) {
        stopStatusPolling();
        await loadDraftFromHelper(helperStatus.draftPath);
        return;
      }
      if (helperStatus?.state === "error") {
        stopStatusPolling();
        setStatus(`生成失败：${helperStatus.message || "未知错误"}`);
      }
    } catch {
      // Keep the current visible status; the foreground prepare request will report the failure.
    }
  }, 1500);
}

async function prepareDraft() {
  const docUrl = els.docUrl.value.trim();
  if (!docUrl) {
    setStatus("请先输入飞书文档链接。");
    return;
  }
  if (state.preparing) return;

  state.preparing = true;
  render();

  await withButtonFeedback(els.prepare, "生成中", async () => {
    setStatus("正在读取飞书文档并下载图片，图片较多时需要等待。");
    startStatusPolling();

    try {
      const res = await fetch(`${helperBase}/prepare`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ docUrl, mediaTimeoutMs: 60000 }),
      });
      const payload = await res.json();
      if (!payload.ok) throw new Error(payload.error || "生成失败");

      applyDraftPayload(payload);
      const stored = await writeLocalStorage({ latestDraft: payload, latestDocUrl: docUrl });
      setStatus(draftGeneratedStatus(payload.draft));
      if (!stored) {
        setStatus(`${draftGeneratedStatus(payload.draft)} ${extensionReloadMessage()}`);
      }
      await markButtonDone(els.prepare, "已生成");
    } catch (error) {
      const message = isExtensionContextInvalidated(error)
        ? extensionReloadMessage()
        : `生成失败：${error.message}`;
      setStatus(message);
    } finally {
      stopStatusPolling();
      state.preparing = false;
      render();
    }
  });
}

async function copyTitle() {
  if (!state.draft) {
    setStatus("当前没有草稿，请先生成或刷新草稿。");
    return;
  }

  await withButtonFeedback(els.copyTitle, "复制中", async () => {
    await navigator.clipboard.writeText(state.draft.title);
    setStatus("标题已复制，请粘贴到 X Articles 标题区域。");
    await markButtonDone(els.copyTitle, "已复制");
  });
}

function fileNameFromPath(filePath, fallback) {
  const name = String(filePath || "")
    .split(/[\\/]/)
    .filter(Boolean)
    .pop();
  return name || fallback;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let output = "";
  const chunkSize = 32768;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    output += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
  }
  return btoa(output);
}

function replaceFileExtension(filePath, extension) {
  const name = fileNameFromPath(filePath, `image.${extension}`);
  return name.replace(/\.[^.]+$/, "") + `.${extension}`;
}

async function compressImageBlob(blob, { maxSize = 1600, quality = 0.88 } = {}) {
  if (!blob.type.startsWith("image/") || blob.type === "image/gif") return blob;
  if (blob.type === "image/jpeg" && blob.size < 900 * 1024) return blob;

  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const compressed = await new Promise((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });
  if (!compressed || compressed.size >= blob.size) return blob;
  return compressed;
}

async function fetchImageFile(image, fallbackName) {
  const res = await fetch(assetUrl(image));
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || `读取图片失败: ${image.marker || fallbackName}`);
  }

  const blob = await res.blob();
  if (!blob.type.startsWith("image/")) {
    throw new Error(`不支持的图片类型: ${blob.type || "unknown"}`);
  }

  const uploadBlob = await compressImageBlob(blob);
  const buffer = await uploadBlob.arrayBuffer();
  const compressed = uploadBlob !== blob;
  return {
    base64: arrayBufferToBase64(buffer),
    mime: uploadBlob.type || blob.type,
    fileName: compressed
      ? replaceFileExtension(image.path, "jpg")
      : fileNameFromPath(image.path, `${fallbackName}.png`),
    bytes: uploadBlob.size,
    originalBytes: blob.size,
    compressed,
  };
}

async function prepareImportPayload() {
  const limit = imageLimitInfo(state.draft);
  const plan = globalThis.XAPImportPlan.buildXImportPlan(state.draft, {
    contentImages: limit.selectedImages,
  });
  const fileMap = new Map();
  const imageOps = [];

  for (let index = 0; index < plan.images.length; index += 1) {
    const image = plan.images[index];
    setStatus(`正在准备图片 ${index + 1}/${plan.images.length}: ${image.marker}`);
    const file = await fetchImageFile(image, `image-${index + 1}`);
    fileMap.set(image.marker, file);
    imageOps.push({
      marker: image.marker,
      file: {
        token: image.marker,
        base64: file.base64,
        mime: file.mime,
        fileName: file.fileName,
        bytes: file.bytes,
        originalBytes: file.originalBytes,
        compressed: file.compressed,
      },
      fallbackText: image.marker,
    });
  }

  return {
    fileMap,
    payload: {
      html: plan.html,
      plain: plan.plain,
      blocks: plan.blocks,
      markerPrefix: plan.markerPrefix,
      images: imageOps,
      imageLimit: {
        maxArticleImages: limit.maxArticleImages,
        coverSlots: limit.coverSlots,
        maxContentImages: limit.maxContentImages,
        totalContentImages: limit.totalContentImages,
        uploadableCount: limit.uploadableCount,
        unavailableCount: limit.unavailableCount,
        limitSkippedCount: limit.limitSkippedCount,
        skippedCount: limit.skippedCount,
      },
    },
  };
}

async function markDraftImported(summary) {
  if (!state.draftPath) return false;

  const res = await fetch(`${helperBase}/imported`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      draftPath: state.draftPath,
      summary,
    }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload.ok) {
    throw new Error(payload.error || "标记已导入失败");
  }
  return true;
}

function runMainImport(payload, fileMap) {
  return new Promise((resolve, reject) => {
    let timeout = null;
    const refreshTimeout = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        window.removeEventListener("message", listener);
        reject(new Error("X 页面导入超时"));
      }, 10 * 60 * 1000);
    };

    const listener = (event) => {
      if (event.source !== window || event.data?.source !== "xap-main") return;
      const message = event.data;

      if (message.kind === "progress") {
        refreshTimeout();
        setStatus(message.text || "正在导入...");
        return;
      }

      if (message.kind === "file-request") {
        const file = fileMap.get(message.token);
        window.postMessage(
          {
            source: "xap",
            kind: "file-response",
            requestId: message.requestId,
            ok: Boolean(file),
            file,
            error: file ? null : `图片数据不存在: ${message.token}`,
          },
          "*",
        );
        return;
      }

      if (message.kind === "done") {
        clearTimeout(timeout);
        window.removeEventListener("message", listener);
        resolve(message.summary || {});
        return;
      }

      if (message.kind === "error") {
        clearTimeout(timeout);
        window.removeEventListener("message", listener);
        reject(new Error(message.error || "X 页面导入失败"));
      }
    };

    window.addEventListener("message", listener);
    refreshTimeout();
    window.postMessage({ source: "xap", kind: "run", payload }, "*");
  });
}

async function importBodyAndImages() {
  if (!state.draft) {
    setStatus("没有草稿，请先粘贴飞书链接并生成草稿。");
    return;
  }
  if (state.importing) return;

  state.importing = true;
  render();
  setStatus("正在准备自动导入...");

  try {
    const { payload, fileMap } = await prepareImportPayload();
    const skippedParts = [];
    if (payload.imageLimit?.unavailableCount > 0) {
      skippedParts.push(`下载失败跳过 ${payload.imageLimit.unavailableCount} 张`);
    }
    if (payload.imageLimit?.limitSkippedCount > 0) {
      skippedParts.push(`超限跳过 ${payload.imageLimit.limitSkippedCount} 张`);
    }
    const skipText = skippedParts.length ? `，${skippedParts.join("，")}` : "";
    setStatus(`图片准备完成，正在导入正文和 ${payload.images.length} 张正文图${skipText}...`);
    const summary = await runMainImport(payload, fileMap);
    const cleanupText = summary.markerCleanupSkipped
      ? `重排未确认，保留 ${summary.markerCountBeforeSkippedCleanup || 0} 个 marker`
      : "marker 已处理";
    const failText =
      summary.imgFail > 0 ? `，失败 ${summary.imgFail} 张，先不要发布` : "";
    const resultPrefix =
      summary.imgFail > 0 || (payload.imageLimit?.skippedCount || 0) > 0
        ? "自动导入未完整完成"
        : "自动导入完成";
    let localCleanupText = "";
    if ((summary.imgFail || 0) === 0 && (payload.imageLimit?.skippedCount || 0) === 0) {
      try {
        const marked = await markDraftImported(summary);
        localCleanupText = marked ? "；本地图片将在 24 小时后自动清理" : "";
      } catch (error) {
        localCleanupText = `；本地清理标记失败：${error.message}`;
      }
    }
    setStatus(
      `${resultPrefix}：上传 ${summary.imgOk || 0}/${payload.images.length} 张图，重排 ${
        summary.relocatedImages || 0
      }/${summary.imgOk || 0}，${cleanupText}${skipText}${failText}${localCleanupText}。请检查后再发布。`,
    );
  } catch (error) {
    setStatus(`自动导入失败：${error.message}`);
  } finally {
    state.importing = false;
    render();
  }
}

try {
  chrome.runtime.onMessage?.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "XAP_PAGE_STATUS") return;
    sendResponse({
      ok: true,
      url: location.href,
      title: document.title,
      contentVersion: XAP_CONTENT_VERSION,
    });
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.latestDraft) {
      loadStoredDraft();
    }
  });
} catch (error) {
  if (isExtensionContextInvalidated(error)) {
    setStatus(extensionReloadMessage());
  } else {
    throw error;
  }
}

createPanel();
refreshDraft();
