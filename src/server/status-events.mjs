export function mediaProgressStatus(event) {
  const base = {
    phase: "media",
    current: event.index,
    total: event.total,
  };

  if (event.type === "media-download-start") {
    return {
      ...base,
      message: "正在下载图片",
    };
  }

  if (event.type === "media-download-done") {
    return {
      ...base,
      lastPath: event.path,
      message: "已下载图片",
    };
  }

  if (event.type === "media-download-error") {
    return {
      ...base,
      error: event.error,
      message: "图片下载失败，继续处理",
    };
  }

  return null;
}
