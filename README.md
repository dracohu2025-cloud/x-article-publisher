# X Article Publisher

把飞书文档转换成 X Articles 可发布的草稿素材包。当前版本只生成草稿和辅助复制内容，不自动点击发布。

## 前置条件

- Node.js 22+
- 本机已配置 `lark-cli`
- 当前飞书身份有权限读取目标文档

## 生成草稿

```bash
npm run prepare:feishu -- --doc "https://g1mu6da08l.feishu.cn/docx/QU7Id9wm4olchQxwTwgc8u5vnVg?from=from_copylink"
```

输出目录默认在 `.xap/drafts/`，包含：

- `draft.json`：结构化草稿
- `body.html`：可粘贴到 X Articles 的正文富文本
- `source.md`：飞书文档原始 Markdown
- `assets/`：下载后的飞书图片

## 启动本地 Helper

```bash
npm run helper
```

默认监听：

```text
http://127.0.0.1:49231
```

接口：

- `GET /health`
- `POST /prepare`，请求体：`{"docUrl":"https://...feishu.cn/docx/..."}`
- `POST /clear`，清空 helper 记录的最近草稿状态，不删除 `.xap/drafts/` 文件
- `POST /imported`，自动导入完整成功后标记草稿，供后台清理本地图片使用

## Chrome 插件

1. 打开 `chrome://extensions`
2. 开启 Developer mode
3. Load unpacked，选择本仓库的 `extension/` 目录
4. 先运行 `npm run helper`
5. 打开 X Articles。进入页面后，右下角会出现“XAP 导入”浮动面板。
6. 在右下角面板输入飞书文档链接，点击“生成草稿”。
7. 草稿生成后，点击“复制标题”，粘贴到 X Articles 标题区域。
8. 点击“自动导入正文+图片”。插件会写入正文、插入图片 marker、调用 X 编辑器自己的上传函数上传正文图片，并清理 marker。
9. 自动导入完整成功且没有跳过图片时，helper 会标记该草稿；24 小时后定时清理只会删除对应草稿的 `assets/` 图片目录，保留 `draft.json`、`body.html` 和 `source.md`。
10. 需要换文档或清掉旧状态时，点击右下角面板的“清空草稿”。它只清空插件面板和 helper 最近状态，不删除本地草稿文件。
11. 浏览器插件栏弹窗只作为入口使用：打开 X Articles、检查 helper、查看最近草稿摘要。
12. 如果自动导入失败，先不要发布，保留页面状态并记录浮动面板的错误信息。

## 当前边界

- 飞书文档中的所有图片都会进入正文图片队列；工具不再默认把第一张图片当封面从正文中移除。
- X 官方帮助页未公开 Articles 图片数量上限。当前工具仅保留总图片数 26 张的保护：正文最多自动导入 26 张；超出部分会跳过且不生成 marker，图片很多的文章建议拆篇发布。
- 自动导入正文图片借鉴 xPoster 的思路：在 X 页面 MAIN world 中查找编辑器内部的 Draft.js 状态和 `onFilesAdded` 上传函数。它不是官方 API，如果 X 改编辑器内部实现，可能需要维护。
- 批量 HTML 图片粘贴已知会在 X Articles 中降级成相机占位，因此插件不再提供“复制正文+图片”。主流程是自动导入。
- 本地图片清理只作用于已完整导入的草稿，且只删除 `assets/` 目录；可用 `XAP_CLEANUP_INTERVAL_HOURS` 和 `XAP_IMPORTED_ASSET_RETENTION_HOURS` 调整默认的 24 小时间隔和保留期。
- 飞书 `<quote-container>` 会转换为引用块。
- 表格、画板、任务等复杂飞书块暂未深度转换，会给出 warning 或按文本降级。
- 由于 X 没有公开 Articles 发布 API，工具默认停在草稿/预览阶段。
