export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

export function inlineMarkdownToHtml(value) {
  const links = [];
  const withLinkPlaceholders = String(value).replace(
    /\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g,
    (_match, label, url) => {
      const placeholder = `@@XAP_LINK_${links.length}@@`;
      links.push(
        `<a href="${escapeAttribute(url)}">${escapeHtml(label)}</a>`,
      );
      return placeholder;
    },
  );

  let html = escapeHtml(withLinkPlaceholders);

  html = html.replace(
    /(https?:\/\/[^\s<>"'）)，,]+)/g,
    (url) => `<a href="${escapeAttribute(url)}">${url}</a>`,
  );

  links.forEach((link, index) => {
    html = html.replaceAll(`@@XAP_LINK_${index}@@`, link);
  });

  html = html
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  return html;
}
