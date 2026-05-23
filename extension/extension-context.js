(function () {
  function isExtensionContextInvalidated(error) {
    return /Extension context invalidated/i.test(String(error?.message || error || ""));
  }

  function extensionReloadMessage() {
    return "插件刚重新加载，当前页面还在使用旧脚本。请刷新 X Articles 页面后点击“刷新草稿”。";
  }

  globalThis.XAPExtensionContext = {
    isExtensionContextInvalidated,
    extensionReloadMessage,
  };
})();
