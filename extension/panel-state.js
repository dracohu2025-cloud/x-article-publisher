(function () {
  function buildButton(visible, enabled) {
    return { visible, enabled };
  }

  function buildPanelView(state) {
    const hasDraft = Boolean(state?.draft);
    const preparing = Boolean(state?.preparing);
    const importing = Boolean(state?.importing);
    const mode = importing ? "importing" : preparing ? "preparing" : hasDraft ? "ready" : "empty";

    return {
      mode,
      sections: {
        input: !importing,
        prepareActions: !importing,
        summary: hasDraft && !preparing,
        hint: !preparing && !importing,
        draftActions: hasDraft && !preparing,
      },
      buttons: {
        prepare: buildButton(!importing, !preparing),
        copyTitle: buildButton(hasDraft && !preparing && !importing, true),
        import: buildButton(hasDraft && !preparing, !importing),
        reload: buildButton(hasDraft && !preparing && !importing, true),
        clearDraft: buildButton(hasDraft && !preparing && !importing, true),
      },
    };
  }

  function clampPercent(value) {
    return Math.max(0, Math.min(100, Math.round(value)));
  }

  function importProgressFromStatus(message, { totalImages = 0 } = {}) {
    const text = String(message || "");
    const total = Math.max(0, Number(totalImages) || 0);

    if (/自动导入完成|续传完成/.test(text)) {
      return { percent: 100, label: "导入完成", indeterminate: false };
    }

    const uploadedMatch = text.match(/上传\s*(\d+)\/(\d+)\s*张图/);
    if (uploadedMatch) {
      const current = Number(uploadedMatch[1]) || 0;
      const matchedTotal = Math.max(1, Number(uploadedMatch[2]) || total || 1);
      return {
        percent: clampPercent((current / matchedTotal) * 100),
        label: `上传图片 ${current}/${matchedTotal}`,
        indeterminate: false,
      };
    }

    const prepareMatch = text.match(/正在准备图片\s*(\d+)\/(\d+)/);
    if (prepareMatch) {
      const current = Number(prepareMatch[1]) || 0;
      const matchedTotal = Math.max(1, Number(prepareMatch[2]) || total || 1);
      return {
        percent: clampPercent((current / matchedTotal) * 20),
        label: `准备图片 ${current}/${matchedTotal}`,
        indeterminate: false,
      };
    }

    const markerMatch = text.match(/\[XAP-IMG-(\d+)]/);
    if (markerMatch && total > 0) {
      const current = Math.min(total, Math.max(1, Number(markerMatch[1]) || 1));
      return {
        percent: clampPercent(20 + ((current - 1) / total) * 75),
        label: `上传图片 ${current}/${total}`,
        indeterminate: false,
      };
    }

    if (/图片准备完成|正在导入正文/.test(text)) {
      return { percent: 20, label: "写入正文", indeterminate: false };
    }

    if (/正在准备自动导入|正在导入|正在上传|正在把本批|图片仍在处理/.test(text)) {
      return { percent: 8, label: "导入中", indeterminate: true };
    }

    return null;
  }

  globalThis.XAPPanelState = { buildPanelView, importProgressFromStatus };
})();
