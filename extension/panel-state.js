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

  globalThis.XAPPanelState = { buildPanelView };
})();
