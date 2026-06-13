(function installXAPMainWorldBridge() {
  const CHANNEL_TO_MAIN = "xap";
  const CHANNEL_FROM_MAIN = "xap-main";
  const BRIDGE_VERSION = "draft-block-write-v4";
  const BRIDGE_CAPABILITIES = Object.freeze({
    resumeMarkers: true,
    batchedUploads: true,
  });
  const EDITOR_SELECTOR =
    "[data-contents='true'] [contenteditable='true'], [contenteditable='true'][role='textbox'], [contenteditable='true'].public-DraftEditor-content, [contenteditable='true']";
  const BASE_MEDIA_UPLOAD_TIMEOUT_MS = 45_000;
  const LARGE_BATCH_MEDIA_UPLOAD_TIMEOUT_MS = 90_000;
  const RETRY_MEDIA_UPLOAD_TIMEOUT_MS = 120_000;
  const MAX_MEDIA_UPLOAD_TIMEOUT_MS = 150_000;
  const LARGE_BATCH_SIZE = 16;
  const MEDIA_UPLOAD_BATCH_SIZE = 5;
  const MAX_MARKER_UPLOAD_ATTEMPTS = 3;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function uploadTimeoutMs({ total = 1, index = 1, attempt = 1 } = {}) {
    const imageCount = Math.max(1, Number(total) || 1);
    const imageIndex = Math.max(1, Number(index) || 1);
    const uploadAttempt = Math.max(1, Number(attempt) || 1);
    const largeBatch = imageCount >= LARGE_BATCH_SIZE || imageIndex >= LARGE_BATCH_SIZE;
    const base = largeBatch
      ? LARGE_BATCH_MEDIA_UPLOAD_TIMEOUT_MS + Math.max(0, imageIndex - LARGE_BATCH_SIZE) * 2_500
      : BASE_MEDIA_UPLOAD_TIMEOUT_MS;
    const withRetry = uploadAttempt > 1 ? Math.max(base, RETRY_MEDIA_UPLOAD_TIMEOUT_MS) : base;
    return Math.min(MAX_MEDIA_UPLOAD_TIMEOUT_MS, withRetry);
  }

  function retryDelayMs({ total = 1, attempt = 1 } = {}) {
    const imageCount = Math.max(1, Number(total) || 1);
    const uploadAttempt = Math.max(1, Number(attempt) || 1);
    const base = imageCount >= LARGE_BATCH_SIZE ? 5_000 : 1_400;
    return base * uploadAttempt;
  }

  function post(kind, payload = {}) {
    window.postMessage({ source: CHANNEL_FROM_MAIN, kind, ...payload }, "*");
  }

  function progress(text, level = "work") {
    post("progress", { text, level });
  }

  function findEditorElement() {
    for (const element of document.querySelectorAll(EDITOR_SELECTOR)) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 200 && rect.height > 80) return element;
    }
    return null;
  }

  function reactFiberKey(element) {
    return Object.keys(element || {}).find(
      (key) => key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$"),
    );
  }

  function findDraftStateNode() {
    const editor = findEditorElement();
    const key = reactFiberKey(editor);
    if (!key) return null;

    let fiber = editor[key];
    for (let depth = 0; depth < 80 && fiber; depth += 1) {
      const stateNode = fiber.stateNode;
      if (stateNode?.props?.editorState && typeof stateNode.props.onChange === "function") {
        return stateNode;
      }
      fiber = fiber.return;
    }
    return null;
  }

  function findOnFilesAdded() {
    const editor = findEditorElement();
    const key = reactFiberKey(editor);
    if (!key) return null;

    let fiber = editor[key];
    for (let depth = 0; depth < 160 && fiber; depth += 1) {
      const props = fiber.memoizedProps || fiber.stateNode?.props;
      if (typeof props?.onFilesAdded === "function") return props.onFilesAdded;
      const nested = findOnFilesAddedInFiberChildren(fiber.child, 0);
      if (nested) return nested;
      fiber = fiber.return;
    }
    return null;
  }

  function findOnFilesAddedInFiberChildren(fiber, depth) {
    if (!fiber || depth > 8) return null;
    const props = fiber.memoizedProps || fiber.stateNode?.props;
    if (typeof props?.onFilesAdded === "function") return props.onFilesAdded;
    return (
      findOnFilesAddedInFiberChildren(fiber.child, depth + 1) ||
      findOnFilesAddedInFiberChildren(fiber.sibling, depth)
    );
  }

  function pasteHtml(html, plain) {
    const editor = findEditorElement();
    if (!editor) return false;
    editor.focus();
    const data = new DataTransfer();
    data.setData("text/html", html);
    data.setData("text/plain", plain || html.replace(/<[^>]*>/g, ""));
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    if (event.clipboardData !== data) {
      Object.defineProperty(event, "clipboardData", { value: data });
    }
    editor.dispatchEvent(event);
    return true;
  }

  function firstCharacterMetadata(block, requireStyle = false) {
    const characterList = block?.getCharacterList?.();
    if (!characterList) return null;
    const size =
      typeof characterList.size === "number"
        ? characterList.size
        : typeof characterList.count === "function"
          ? characterList.count()
          : 0;
    for (let index = 0; index < size; index += 1) {
      const character = characterList.get?.(index);
      if (character?.set && (!requireStyle || character.getStyle)) return character;
    }
    const first = characterList.first?.() || characterList.get?.(0);
    return first?.set && (!requireStyle || first.getStyle) ? first : null;
  }

  function findDraftCharacterSample(draftNode) {
    const blockMap = draftNode?.props?.editorState?.getCurrentContent?.()?.getBlockMap?.();
    if (!blockMap?.forEach) return null;
    let found = null;
    blockMap.forEach((block) => {
      if (found) return false;
      const character = firstCharacterMetadata(block, true);
      if (character) {
        found = { block, character };
        return false;
      }
      return true;
    });
    return found;
  }

  function findDraftSampleBlock(draftNode) {
    return findDraftCharacterSample(draftNode)?.block || null;
  }

  async function ensureDraftCharacterSample(draftNode) {
    if (findDraftSampleBlock(draftNode)) return draftNode;
    const editor = findEditorElement();
    if (!editor) return draftNode;

    editor.focus();
    document.execCommand("insertText", false, "x");

    const deadline = Date.now() + 1600;
    while (Date.now() < deadline) {
      await sleep(80);
      const latestNode = findDraftStateNode() || draftNode;
      if (findDraftSampleBlock(latestNode)) return latestNode;
    }
    return findDraftStateNode() || draftNode;
  }

  function draftInlineStyleName(style) {
    return (
      {
        Bold: "BOLD",
        Italic: "ITALIC",
        Strikethrough: "STRIKETHROUGH",
        Code: "CODE",
      }[style] || style
    );
  }

  function writeDraftBlocks(draftNode, blocks) {
    if (!Array.isArray(blocks) || !blocks.length) {
      return { ok: false, error: "No structured blocks" };
    }

    const editorState = draftNode.props.editorState;
    const EditorState = editorState.constructor;
    const SelectionState = editorState.getSelection().constructor;
    const contentState = editorState.getCurrentContent();
    const blockMap = contentState.getBlockMap();
    const sample = findDraftCharacterSample(draftNode);
    const sampleBlock = sample?.block || null;
    const sampleCharacter = sample?.character || null;
    if (!sampleBlock || !sampleCharacter) {
      return { ok: false, error: "No Draft.js character sample for structured write" };
    }

    const BlockMap = blockMap.constructor;
    const CharacterList = sampleBlock.getCharacterList().constructor;
    let nextContent = contentState;
    let nextBlockMap = BlockMap();
    const createdKeys = [];

    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index] || {};
      const text = String(block.text || "").replace(/\n+/g, " ");
      const key = `${Math.random().toString(36).slice(2, 7)}${index.toString(36)}`;
      let characterList = CharacterList();
      const entityRanges = new Map();

      for (const link of block.links || []) {
        const offset = Number(link.offset) || 0;
        const length = Math.max(0, Number(link.length) || 0);
        if (!length || !link.url) continue;
        nextContent = nextContent.createEntity("LINK", "MUTABLE", {
          url: String(link.url),
        });
        entityRanges.set(`${offset}:${offset + length}`, nextContent.getLastCreatedEntityKey());
      }

      for (let charIndex = 0; charIndex < text.length; charIndex += 1) {
        const styleNames = (block.inlineStyleRanges || [])
          .filter((range) => charIndex >= range.offset && charIndex < range.offset + range.length)
          .map((range) => draftInlineStyleName(range.style))
          .filter(Boolean);
        let entity = null;
        for (const [range, entityKey] of entityRanges.entries()) {
          const [start, end] = range.split(":").map(Number);
          if (charIndex >= start && charIndex < end) {
            entity = entityKey;
            break;
          }
        }
        let style = sampleCharacter.getStyle().clear();
        for (const styleName of styleNames) style = style.add(styleName);
        characterList = characterList.push(
          sampleCharacter.set("style", style).set("entity", entity),
        );
      }

      const nextBlock = sampleBlock.merge({
        key,
        type: block.type || "unstyled",
        text,
        characterList,
        depth: block.type === "unordered-list-item" || block.type === "ordered-list-item" ? 0 : 0,
        data: sampleBlock.getData?.()?.clear?.() || sampleBlock.getData?.(),
      });
      nextBlockMap = nextBlockMap.set(key, nextBlock);
      createdKeys.push(key);
    }

    if (!createdKeys.length) return { ok: false, error: "No Draft.js blocks created" };
    const lastKey = createdKeys[createdKeys.length - 1];
    const selection = SelectionState.createEmpty(lastKey);
    const nextState = nextContent
      .set("blockMap", nextBlockMap)
      .set("selectionBefore", selection)
      .set("selectionAfter", selection);
    let nextEditorState = EditorState.push(editorState, nextState, "insert-fragment");
    nextEditorState = EditorState.moveSelectionToEnd(nextEditorState);
    draftNode.props.onChange(nextEditorState);
    return { ok: true, blocks: createdKeys.length };
  }

  function findMarkerBlock(contentState, marker) {
    let blockKey = null;
    contentState.getBlockMap().forEach((block, key) => {
      if (blockKey) return false;
      if (block.getType() !== "atomic" && (block.getText() || "").trim() === marker) {
        blockKey = key;
        return false;
      }
      return true;
    });
    return blockKey;
  }

  function countMarkerBlocks(draftNode, markerPrefix) {
    if (!draftNode || !markerPrefix) return 0;
    let count = 0;
    draftNode.props.editorState
      .getCurrentContent()
      .getBlockMap()
      .forEach((block) => {
        if (block.getType() !== "atomic" && (block.getText() || "").trim().startsWith(markerPrefix)) {
          count += 1;
        }
      });
    return count;
  }

  function markerTexts(draftNode, markerPrefix) {
    const markers = new Set();
    if (!draftNode || !markerPrefix) return markers;
    draftNode.props.editorState
      .getCurrentContent()
      .getBlockMap()
      .forEach((block) => {
        const text = (block.getText() || "").trim();
        if (block.getType() !== "atomic" && text.startsWith(markerPrefix)) {
          markers.add(text);
        }
      });
    return markers;
  }

  function pendingImageOperations(imageOps = [], remainingMarkers = new Set()) {
    const markerSet =
      remainingMarkers instanceof Set ? remainingMarkers : new Set(remainingMarkers || []);
    if (!markerSet.size) return { imageOps, resuming: false };
    return {
      imageOps: imageOps.filter((operation) => markerSet.has(operation.marker)),
      resuming: true,
    };
  }

  function imageUploadBatches(imageOps = [], batchSize = MEDIA_UPLOAD_BATCH_SIZE) {
    const size = Math.max(1, Number(batchSize) || MEDIA_UPLOAD_BATCH_SIZE);
    const batches = [];
    for (let index = 0; index < imageOps.length; index += size) {
      batches.push(imageOps.slice(index, index + size));
    }
    return batches;
  }

  function nextPendingImageBatch(
    imageOps = [],
    remainingMarkers = new Set(),
    attempts = new Map(),
    { batchSize = MEDIA_UPLOAD_BATCH_SIZE, maxAttempts = MAX_MARKER_UPLOAD_ATTEMPTS } = {},
  ) {
    const pending = pendingImageOperations(imageOps, remainingMarkers).imageOps;
    const resumable = pending.filter((operation) => {
      const count = attempts.get(operation.marker) || 0;
      return count < maxAttempts;
    });
    const [batch = []] = imageUploadBatches(resumable, batchSize);
    return {
      imageOps: batch,
      pendingCount: resumable.length,
      exhaustedCount: pending.length - resumable.length,
    };
  }

  async function waitForMarkers(markerPrefix, expectedCount, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    let latestNode = findDraftStateNode();
    let latestCount = countMarkerBlocks(latestNode, markerPrefix);
    while (Date.now() < deadline) {
      latestNode = findDraftStateNode() || latestNode;
      latestCount = countMarkerBlocks(latestNode, markerPrefix);
      if (latestNode && latestCount >= expectedCount) {
        return { ok: true, draftNode: latestNode, count: latestCount };
      }
      await sleep(120);
    }
    latestNode = findDraftStateNode() || latestNode;
    latestCount = countMarkerBlocks(latestNode, markerPrefix);
    return { ok: false, draftNode: latestNode, count: latestCount };
  }

  async function waitForMarkerCountAtMost(
    markerPrefix,
    maxCount,
    timeoutMs = 12000,
    stableMs = 2500,
  ) {
    const deadline = Date.now() + timeoutMs;
    let latestNode = findDraftStateNode();
    let latestCount = countMarkerBlocks(latestNode, markerPrefix);
    let stableSince = latestCount <= maxCount ? Date.now() : null;
    while (Date.now() < deadline) {
      latestNode = findDraftStateNode() || latestNode;
      latestCount = countMarkerBlocks(latestNode, markerPrefix);
      if (latestNode && latestCount <= maxCount) {
        stableSince ||= Date.now();
      } else {
        stableSince = null;
      }
      if (latestNode && stableSince && Date.now() - stableSince >= stableMs) {
        return { ok: true, draftNode: latestNode, count: latestCount };
      }
      await sleep(150);
    }
    latestNode = findDraftStateNode() || latestNode;
    latestCount = countMarkerBlocks(latestNode, markerPrefix);
    return { ok: false, draftNode: latestNode, count: latestCount };
  }

  async function waitForSelectionAtBlock(blockKey, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    let latestNode = findDraftStateNode();
    while (Date.now() < deadline) {
      latestNode = findDraftStateNode() || latestNode;
      const selection = latestNode?.props?.editorState?.getSelection?.();
      if (
        selection &&
        selection.getAnchorKey?.() === blockKey &&
        selection.getFocusKey?.() === blockKey
      ) {
        return { ok: true, draftNode: latestNode };
      }
      await sleep(80);
    }
    return { ok: false, draftNode: latestNode };
  }

  function placeSelectionAtMarker(draftNode, marker) {
    const editorState = draftNode.props.editorState;
    const SelectionState = editorState.getSelection().constructor;
    const EditorState = editorState.constructor;
    const contentState = editorState.getCurrentContent();
    const blockKey = findMarkerBlock(contentState, marker);
    if (!blockKey) return false;
    findEditorElement()?.focus();
    const selection = SelectionState.createEmpty(blockKey).merge({
      anchorOffset: 0,
      focusOffset: 0,
    });
    draftNode.props.onChange(EditorState.forceSelection(editorState, selection));
    return blockKey;
  }

  function existingMediaEntities(contentState) {
    const entities = new Set();
    contentState.getBlockMap().forEach((block) => {
      if (block.getType() !== "atomic") return;
      block.findEntityRanges(
        (character) => Boolean(character.getEntity()),
        (start) => {
          const entityKey = block.getCharacterList().get(start)?.getEntity?.();
          if (!entityKey) return;
          try {
            if (contentState.getEntity(entityKey).getType() === "MEDIA") entities.add(entityKey);
          } catch {}
        },
      );
    });
    return entities;
  }

  function mediaBlockDetails(draftNode, protectedAtomicBlocks = new Set()) {
    const details = [];
    if (!draftNode) return details;
    const contentState = draftNode.props.editorState.getCurrentContent();
    contentState.getBlockMap().forEach((block, blockKey) => {
      if (protectedAtomicBlocks.has(blockKey) || !isMediaBlock(contentState, block)) return;
      let firstEntity = null;
      block.findEntityRanges(
        (character) => Boolean(character.getEntity()),
        (start) => {
          const entityKey = block.getCharacterList().get(start)?.getEntity?.();
          if (entityKey) firstEntity ||= entityKey;
        },
      );
      details.push({ blockKey, entityKey: firstEntity });
    });
    return details;
  }

  function protectExistingMediaBlocks(draftNode, protectedAtomicBlocks = new Set()) {
    if (!draftNode) return protectedAtomicBlocks;
    const contentState = draftNode.props.editorState.getCurrentContent();
    contentState.getBlockMap().forEach((block, blockKey) => {
      if (isMediaBlock(contentState, block)) protectedAtomicBlocks.add(blockKey);
    });
    return protectedAtomicBlocks;
  }

  async function waitForStableMediaCount(
    protectedAtomicBlocks,
    minCount,
    { timeoutMs = 45000, stableMs = 1400 } = {},
  ) {
    const deadline = Date.now() + timeoutMs;
    let latestNode = findDraftStateNode();
    let latestDetails = mediaBlockDetails(latestNode, protectedAtomicBlocks);
    let lastCount = latestDetails.length;
    let stableSince = Date.now();

    while (Date.now() < deadline) {
      await sleep(350);
      latestNode = findDraftStateNode() || latestNode;
      latestDetails = mediaBlockDetails(latestNode, protectedAtomicBlocks);
      if (latestDetails.length !== lastCount) {
        lastCount = latestDetails.length;
        stableSince = Date.now();
      }
      if (latestDetails.length >= minCount && Date.now() - stableSince >= stableMs) {
        return {
          ok: true,
          draftNode: latestNode,
          count: latestDetails.length,
          details: latestDetails,
        };
      }
    }

    latestNode = findDraftStateNode() || latestNode;
    latestDetails = mediaBlockDetails(latestNode, protectedAtomicBlocks);
    return {
      ok: false,
      draftNode: latestNode,
      count: latestDetails.length,
      details: latestDetails,
    };
  }

  function base64ToFile(base64, fileName, mime) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new File([bytes], fileName, { type: mime });
  }

  function requestPreparedFile(operation, timeoutMs = 30000) {
    const token = operation?.file?.token || operation?.marker || "";
    if (operation?.file?.base64) return Promise.resolve(operation.file);
    if (!token) return Promise.reject(new Error("Prepared image token is missing"));

    const requestId = `xap_file_${Math.random().toString(36).slice(2, 10)}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        window.removeEventListener("message", listener);
        reject(new Error("Prepared image data did not arrive"));
      }, timeoutMs);

      const listener = (event) => {
        if (event.source !== window || event.data?.source !== CHANNEL_TO_MAIN) return;
        const message = event.data;
        if (message.kind !== "file-response" || message.requestId !== requestId) return;
        clearTimeout(timeout);
        window.removeEventListener("message", listener);
        if (message.ok && message.file?.base64) resolve(message.file);
        else reject(new Error(message.error || "Prepared image data was not available"));
      };

      window.addEventListener("message", listener);
      post("file-request", { requestId, token, marker: operation.marker });
    });
  }

  async function uploadImageAtMarker(
    draftNode,
    operation,
    protectedAtomicBlocks = new Set(),
    uploadContext = {},
  ) {
    const stableBefore = await waitForStableMediaCount(protectedAtomicBlocks, 0, {
      timeoutMs: 12000,
      stableMs: 900,
    });
    draftNode = stableBefore.draftNode || draftNode;
    const beforeMediaCount = stableBefore.count || 0;

    const preparedFile = await requestPreparedFile(operation);
    const file = base64ToFile(preparedFile.base64, preparedFile.fileName, preparedFile.mime);
    draftNode = findDraftStateNode() || draftNode;
    const markerBlockKey = placeSelectionAtMarker(draftNode, operation.marker);
    if (!markerBlockKey) {
      return { ok: false, error: `Marker not found: ${operation.marker}` };
    }

    const selectionReady = await waitForSelectionAtBlock(markerBlockKey);
    draftNode = selectionReady.draftNode || draftNode;
    if (!selectionReady.ok) {
      return { ok: false, error: `Marker selection did not settle: ${operation.marker}` };
    }

    const onFilesAdded = findOnFilesAdded();
    if (!onFilesAdded) return { ok: false, error: "X upload handler was not reachable" };

    const before = existingMediaEntities(draftNode.props.editorState.getCurrentContent());
    onFilesAdded([file]);
    const timeoutMs = uploadTimeoutMs(uploadContext);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(350);
      draftNode = findDraftStateNode() || draftNode;
      const contentState = draftNode.props.editorState.getCurrentContent();
      const currentMediaCount = mediaBlockDetails(draftNode, protectedAtomicBlocks).length;
      let found = null;
      contentState.getBlockMap().forEach((block, blockKey) => {
        if (found || block.getType() !== "atomic") return;
        block.findEntityRanges(
          (character) => Boolean(character.getEntity()),
          (start) => {
            const entityKey = block.getCharacterList().get(start)?.getEntity?.();
            if (!entityKey || before.has(entityKey)) return;
            try {
              const entity = contentState.getEntity(entityKey);
              if (entity.getType() !== "MEDIA") return;
              found = { entityKey, blockKey };
            } catch {}
          },
        );
      });
      if (found && currentMediaCount > beforeMediaCount) {
        const stableAfter = await waitForStableMediaCount(
          protectedAtomicBlocks,
          beforeMediaCount + 1,
          { timeoutMs, stableMs: 1400 },
        );
        if (stableAfter.ok) return { ok: true, ...found };
      }
    }

    return { ok: false, error: "Timed out waiting for X media upload" };
  }

  function isMediaBlock(contentState, block) {
    if (block?.getType?.() !== "atomic") return false;
    let media = false;
    block.findEntityRanges(
      (character) => Boolean(character.getEntity()),
      (start) => {
        const entityKey = block.getCharacterList().get(start)?.getEntity?.();
        if (!entityKey) return;
        try {
          if (contentState.getEntity(entityKey).getType() === "MEDIA") media = true;
        } catch {}
      },
    );
    return media;
  }

  function relocateImages(draftNode, uploads, protectedAtomicBlocks = new Set()) {
    if (!uploads.length) return { moved: 0, missing: 0 };
    const editorState = draftNode.props.editorState;
    const EditorState = editorState.constructor;
    const SelectionState = editorState.getSelection().constructor;
    const contentState = editorState.getCurrentContent();
    const blockMap = contentState.getBlockMap();
    const markerEntries = new Map(uploads.map((upload) => [upload.marker, upload]));
    const entityToBlock = new Map();
    const mediaBlocks = [];

    blockMap.forEach((block, blockKey) => {
      if (block.getType() === "atomic") {
        let firstEntity = null;
        block.findEntityRanges(
          (character) => Boolean(character.getEntity()),
          (start) => {
            const entityKey = block.getCharacterList().get(start)?.getEntity?.();
            if (entityKey) {
              firstEntity ||= entityKey;
              entityToBlock.set(entityKey, blockKey);
            }
          },
        );
        if (!protectedAtomicBlocks.has(blockKey) && firstEntity && isMediaBlock(contentState, block)) {
          mediaBlocks.push({ blockKey, entityKey: firstEntity });
        }
        return;
      }
      const marker = (block.getText() || "").trim();
      if (markerEntries.has(marker)) markerEntries.get(marker).markerBlock = blockKey;
    });

    const moves = new Map();
    const usedImageBlocks = new Set();
    let missing = 0;
    let fallbackIndex = 0;
    for (const upload of uploads) {
      if (!upload.markerBlock) {
        missing += 1;
        continue;
      }
      let imageBlock = upload.entityKey ? entityToBlock.get(upload.entityKey) : null;
      if (!imageBlock && upload.blockKey && blockMap.has(upload.blockKey) && isMediaBlock(contentState, blockMap.get(upload.blockKey))) {
        imageBlock = upload.blockKey;
      }
      if (!imageBlock) {
        while (fallbackIndex < mediaBlocks.length && usedImageBlocks.has(mediaBlocks[fallbackIndex].blockKey)) {
          fallbackIndex += 1;
        }
        imageBlock = mediaBlocks[fallbackIndex]?.blockKey || null;
        fallbackIndex += 1;
      }
      if (!imageBlock) {
        missing += 1;
        continue;
      }
      if (imageBlock !== upload.markerBlock) moves.set(upload.markerBlock, imageBlock);
      usedImageBlocks.add(imageBlock);
    }

    if (!moves.size) return { moved: 0, missing, mediaBlocks: mediaBlocks.length };
    const destinationBlocks = new Set(moves.values());
    const orderedKeys = [];
    blockMap.forEach((_block, key) => {
      if (moves.has(key)) orderedKeys.push(moves.get(key));
      else if (!destinationBlocks.has(key)) orderedKeys.push(key);
    });

    let nextBlockMap = blockMap.constructor();
    for (const key of orderedKeys) nextBlockMap = nextBlockMap.set(key, blockMap.get(key));
    const lastKey = orderedKeys[orderedKeys.length - 1];
    const selection = SelectionState.createEmpty(lastKey);
    const nextContent = contentState
      .set("blockMap", nextBlockMap)
      .set("selectionBefore", selection)
      .set("selectionAfter", selection);
    let nextEditorState = EditorState.push(editorState, nextContent, "remove-range");
    nextEditorState = EditorState.moveSelectionToEnd(nextEditorState);
    draftNode.props.onChange(nextEditorState);
    return { moved: moves.size, missing, mediaBlocks: mediaBlocks.length };
  }

  function removeUploadedMarkerBlocks(draftNode, uploads) {
    if (!draftNode || !uploads.length) return { removed: 0 };
    const markers = new Set(uploads.map((upload) => upload.marker).filter(Boolean));
    if (!markers.size) return { removed: 0 };

    const editorState = draftNode.props.editorState;
    const EditorState = editorState.constructor;
    const SelectionState = editorState.getSelection().constructor;
    const contentState = editorState.getCurrentContent();
    const blockMap = contentState.getBlockMap();
    const keptKeys = [];
    let removed = 0;

    blockMap.forEach((block, key) => {
      const text = (block.getText() || "").trim();
      if (block.getType() !== "atomic" && markers.has(text)) {
        removed += 1;
        return;
      }
      keptKeys.push(key);
    });

    if (!removed || !keptKeys.length) return { removed };

    let nextBlockMap = blockMap.constructor();
    for (const key of keptKeys) nextBlockMap = nextBlockMap.set(key, blockMap.get(key));
    const lastKey = keptKeys[keptKeys.length - 1];
    const selection = SelectionState.createEmpty(lastKey);
    const nextContent = contentState
      .set("blockMap", nextBlockMap)
      .set("selectionBefore", selection)
      .set("selectionAfter", selection);
    let nextEditorState = EditorState.push(editorState, nextContent, "remove-range");
    nextEditorState = EditorState.moveSelectionToEnd(nextEditorState);
    draftNode.props.onChange(nextEditorState);
    return { removed };
  }

  async function settleUploadedBatch(
    draftNode,
    uploads,
    protectedAtomicBlocks,
    markerPrefix,
    markersBeforeCount,
    summary,
  ) {
    if (!uploads.length) return draftNode;

    const stableUploads = await waitForStableMediaCount(
      protectedAtomicBlocks,
      uploads.length,
      { timeoutMs: 60000, stableMs: 2200 },
    );
    draftNode = stableUploads.draftNode || draftNode;
    summary.stableMediaCount = stableUploads.count;
    if (!stableUploads.ok) {
      progress(`图片仍在处理：当前稳定媒体块 ${stableUploads.count}/${uploads.length}`, "warn");
    }

    progress(`正在把本批 ${uploads.length} 张图片移动到 marker 位置...`);
    await sleep(1200);
    draftNode = findDraftStateNode() || draftNode;
    const result = relocateImages(draftNode, uploads, protectedAtomicBlocks);
    summary.relocatedImages += result.moved;
    summary.relocationMissing += result.missing || 0;
    summary.mediaBlocksSeen = result.mediaBlocks;
    progress(`本批图片重排完成：移动 ${result.moved}/${uploads.length}，缺失 ${result.missing || 0}`);

    await sleep(500);
    draftNode = findDraftStateNode() || draftNode;
    const cleanup = removeUploadedMarkerBlocks(draftNode, uploads);
    summary.removedMarkers += cleanup.removed;
    if (cleanup.removed > 0) {
      progress(`已清理本批 ${cleanup.removed}/${uploads.length} 个图片 marker。`);
    }

    const confirmation = await waitForMarkerCountAtMost(
      markerPrefix,
      Math.max(0, markersBeforeCount - uploads.length),
      12000,
      2500,
    );
    summary.relocationConfirmed = summary.relocationConfirmed && confirmation.ok;
    summary.markerCountAfterRelocation = confirmation.count;
    draftNode = confirmation.draftNode || findDraftStateNode() || draftNode;
    protectExistingMediaBlocks(draftNode, protectedAtomicBlocks);
    return draftNode;
  }

  async function runFlow(payload) {
    const allImageOps = payload.images || [];
    let imageOps = allImageOps;
    let resuming = false;
    let draftNode = findDraftStateNode();
    const existingMarkerTexts = markerTexts(draftNode, payload.markerPrefix);

    if (existingMarkerTexts.size > 0 && allImageOps.length > 0) {
      const pending = pendingImageOperations(allImageOps, existingMarkerTexts);
      if (!pending.imageOps.length) {
        throw new Error(
          `检测到页面已有 ${existingMarkerTexts.size} 个图片 marker，但与当前草稿不匹配。请清空当前 X 编辑器后重试。`,
        );
      }
      imageOps = pending.imageOps;
      resuming = pending.resuming;
      progress(`检测到 ${imageOps.length} 个未处理 marker，继续上传剩余图片...`);
    } else {
      progress("正在通过 Draft.js 写入正文和图片 marker...");
      draftNode = await ensureDraftCharacterSample(draftNode);
      const writeResult = writeDraftBlocks(draftNode, payload.blocks);
      if (!writeResult.ok) {
        progress("结构化写入失败，改用 HTML 粘贴兜底...", "warn");
        if (!pasteHtml(payload.html, payload.plain)) {
          throw new Error("X editor was not reachable for paste");
        }
      }
    }

    const markerWait = await waitForMarkers(payload.markerPrefix, imageOps.length);
    draftNode = markerWait.draftNode;
    if (!draftNode) throw new Error("X Draft.js editor was not reachable");
    if (imageOps.length > 0 && markerWait.count < imageOps.length) {
      throw new Error(
        `正文 marker 未完整写入：检测到 ${markerWait.count}/${imageOps.length}。请刷新页面后重试。`,
      );
    }

    const protectedAtomicBlocks = new Set();
    draftNode.props.editorState
      .getCurrentContent()
      .getBlockMap()
      .forEach((block, key) => {
        if (block.getType() === "atomic") protectedAtomicBlocks.add(key);
      });
    protectExistingMediaBlocks(draftNode, protectedAtomicBlocks);
    const summary = {
      imgOk: 0,
      imgFail: 0,
      relocatedImages: 0,
      relocationMissing: 0,
      removedMarkers: 0,
      relocationConfirmed: true,
      markerCleanupSkipped: false,
      imageErrors: [],
      attemptedImages: imageOps.length,
      totalImages: allImageOps.length,
      resumed: resuming,
      batches: 0,
      batchSize: MEDIA_UPLOAD_BATCH_SIZE,
      exhaustedImages: 0,
    };
    const uploadPolicyTotal = Math.max(imageOps.length, allImageOps.length);
    const attempts = new Map();
    const uploadErrors = new Map();

    while (true) {
      draftNode = findDraftStateNode() || draftNode;
      const remainingMarkerTexts = markerTexts(draftNode, payload.markerPrefix);
      const nextBatch = nextPendingImageBatch(imageOps, remainingMarkerTexts, attempts);
      summary.exhaustedImages = nextBatch.exhaustedCount;
      if (!nextBatch.imageOps.length) break;

      summary.batches += 1;
      const batchUploads = [];
      const markersBeforeCount = remainingMarkerTexts.size;
      progress(
        `小批量上传第 ${summary.batches} 批：${nextBatch.imageOps.length} 张，当前剩余 ${nextBatch.pendingCount} 张...`,
      );

      for (let batchIndex = 0; batchIndex < nextBatch.imageOps.length; batchIndex += 1) {
        const op = nextBatch.imageOps[batchIndex];
        const attempt = (attempts.get(op.marker) || 0) + 1;
        attempts.set(op.marker, attempt);
        const absoluteIndex = Math.max(1, imageOps.findIndex((image) => image.marker === op.marker) + 1);
        draftNode = findDraftStateNode() || draftNode;
        progress(
          `正在上传第 ${summary.batches} 批 ${batchIndex + 1}/${nextBatch.imageOps.length}（第 ${attempt}/${MAX_MARKER_UPLOAD_ATTEMPTS} 次）: ${op.marker}`,
        );
        const result = await uploadImageAtMarker(draftNode, op, protectedAtomicBlocks, {
          index: absoluteIndex,
          total: uploadPolicyTotal,
          attempt,
        });

        if (result.ok) {
          batchUploads.push({
            marker: op.marker,
            blockKey: result.blockKey,
            entityKey: result.entityKey,
          });
          uploadErrors.delete(op.marker);
        } else {
          uploadErrors.set(op.marker, result.error || "Image upload failed");
        }
      }

      draftNode = await settleUploadedBatch(
        draftNode,
        batchUploads,
        protectedAtomicBlocks,
        payload.markerPrefix,
        markersBeforeCount,
        summary,
      );
      if (!batchUploads.length) {
        await sleep(retryDelayMs({ total: uploadPolicyTotal, attempt: 1 }));
      }
    }

    draftNode = findDraftStateNode() || draftNode;
    const finalMarkerTexts = markerTexts(draftNode, payload.markerPrefix);
    const finalPending = pendingImageOperations(imageOps, finalMarkerTexts).imageOps;
    const markerCount = finalPending.length;
    summary.imgOk = Math.max(0, imageOps.length - finalPending.length);
    summary.imgFail = finalPending.length;
    summary.imageErrors = finalPending.map((operation) => ({
      marker: operation.marker,
      error: uploadErrors.get(operation.marker) || "Image marker was not cleared after upload",
    }));
    if (markerCount === 0) {
      progress("图片 marker 已处理完成。");
    } else {
      summary.markerCleanupSkipped = true;
      summary.markerCountBeforeSkippedCleanup = markerCount;
      progress(
        `仍有 ${markerCount} 个 marker 未处理完成，已保留用于下次续传。请保留页面并反馈这个数字。`,
        "warn",
      );
    }
    post("done", { summary });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== CHANNEL_TO_MAIN) return;
    if (event.data.kind === "ready?") {
      post("ready", { version: BRIDGE_VERSION, capabilities: BRIDGE_CAPABILITIES });
      return;
    }
    if (event.data.kind === "run") {
      runFlow(event.data.payload).catch((error) => {
        post("error", { error: error?.message || String(error), stack: error?.stack || null });
      });
    }
  });

  window.__XAP_MAIN_VERSION = BRIDGE_VERSION;
  window.__XAP_UPLOAD_POLICY = {
    uploadTimeoutMs,
    retryDelayMs,
    pendingImageOperations,
    imageUploadBatches,
    nextPendingImageBatch,
  };
  post("ready", { version: BRIDGE_VERSION, capabilities: BRIDGE_CAPABILITIES });
})();
