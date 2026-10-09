# AGENTS.md

## Commands

- Install: `npm install`（若 Electron 二进制缺失：`node node_modules/electron/install.js`）
- Dev: `npm run dev`
- Typecheck: `npm run typecheck`（= typecheck:node + typecheck:web）
- Lint: `npm run lint`
- Build: `npm run build`
- Package: `npm run pack:mac` / `npm run pack:win`

修改代码后务必运行 `npm run typecheck` 与 `npm run lint`。

## 架构要点

- 三进程：main / preload / renderer。安全配置：`contextIsolation: true`、`nodeIntegration: false`。
- 所有网络、文件、DB、Cookie 操作都在 **main** 进程；renderer 只通过 `window.api`（见 `src/shared/ipc.ts` 的 `RendererApi`）调用。
- 新增 IPC：在 `src/shared/ipc.ts` 增加通道与类型 → `src/main/ipc/index.ts` 注册 handler → `src/preload/index.ts` 暴露。
- 路径别名：main 用 `@main/*`、`@shared/*`；renderer 用 `@renderer/*`、`@shared/*`。别名同时配置在 `electron.vite.config.ts` 与对应 tsconfig。
- Markdown 管线在 `src/shared/markdown.ts`，main 与 renderer 共用。

## 主题（跟随系统外观）

- 颜色一律使用语义 token，不要写死 hex：在 `src/renderer/src/index.css` 用 RGB 三元组定义 CSS 变量（`--panel/--panel2/--edge/--fg/--muted/--faint/--accent` 等），并在 `:root` 与 `@media (prefers-color-scheme: dark)` 分别赋值；`tailwind.config.js` 里映射为 `rgb(var(--x) / <alpha-value>)`。
- 文本用 `text-fg` / `text-muted` / `text-faint`，不要再用 `text-gray-*`。
- CodeMirror 编辑器用 `Compartment` + `matchMedia('(prefers-color-scheme: dark)')` 在系统主题变化时切换明/暗主题（`Editor.tsx`）。
- 主窗口 `backgroundColor` 由 `nativeTheme.shouldUseDarkColors` 决定（`src/main/index.ts`）。

## 原生模块（macOS 安全作用域 bookmark）

- `native/mac-bookmark` 是 N-API 原生模块（Objective-C++），提供 `createBookmark` / `startAccessing` / `stopAccessing` / `stopAll`，用于 App Sandbox 下持久化工作区访问权限。
- 编译：`npm run build:native`（`npx node-gyp rebuild -C native/mac-bookmark`）；`pack:mac` / `pack:mas` 会自动先编译。
- 打包：`electron-builder.yml` 的 `mac/mas.extraResources` 将其放入 `Resources/mac-bookmark/mac-bookmark.node`。
- 加载：`src/main/mac/bookmark.ts`，dev 走 `app.getAppPath()/process.cwd()`，打包走 `process.resourcesPath`；非 macOS 或缺失时降级为普通路径（返回 null）。
- 集成：`src/main/fs/workspace.ts` 在 `setWorkspace` 存 bookmark（setting `workspace.bookmark`），`loadWorkspace` 恢复访问；退出时 `stopWorkspaceAccess()`。
- 修改原生代码后必须重新 `build:native` 才能生效；N-API 版本固定为 8 以兼容 Node/Electron。

## 本地图片预览

- 自定义协议 `mdp://local/<绝对路径>`（`src/main/assets.ts`），由 `protocol.handle` 用 `net.fetch(file://)` 提供文件。方案需在 app ready 前 `registerSchemesAsPrivileged`。
- 渲染端把 Markdown 图片相对路径按**文档所在目录**解析（不是工作区根目录），见 `src/renderer/src/lib/assets.ts` 的 `resolveImageSrc`；`Preview.tsx` 用 DOMParser 改写 `<img>`。
- 发布时相对图片由适配器用 `article.baseDir` 解析（`adapters/images.ts`）。
- CSP 的 `img-src` 必须包含 `mdp:`。

## 数据库

- better-sqlite3 v13（N-API，跨平台预编译）。位于 `app.getPath('userData')/data.db`。
- 迁移：`src/main/db/index.ts` 的 `migrations` 数组，用 `user_version` 记录版本，新增改动请追加迁移而非修改已有项。

## 平台适配器

- 统一的 `CookieAdapter`（`src/main/adapters/base.ts`）：`checkAuth` / `login` / `publish` / `uploadImage`。
- 登录：`session-manager.ts` 打开带独立 `persist:` 分区的登录窗口并轮询 `probe`。
- 均为**非官方**内部接口逆向实现，接口易变。修改时在注释标明来源与不确定性。
- 微信公众号正文必须内联样式（不能依赖 class / 外部 CSS），见 `src/main/markdown/wechat-style.ts`。
- 微信公众号正文会拒绝任何非微信域名的 `<a>` 链接（**连 `#` 锚点也会触发「请勿插入非微信域名的链接」**），因此 `stripLinksForWechat` 会去掉除微信域名外的所有 `<a>`；未上传成功的图片由 `dropExternalImages` 移除（图片必须先上传到微信图床）。
- 调试发布：`npm run verify:publish`（先改 `scripts/verify-publish.ts` 顶部的 `ROOT`/`DOC_ID`；用 `PUBLISH=juejin,zhihu` 选择平台），会走真实 pipeline 并创建草稿。
- 掘金图床上传走字节 ImageX（`signAWS4` + TOS PUT + Commit，见 `src/main/adapters/crypto.ts`）；`CommitImageUpload` 不能手动设置 `Content-Length`，否则 Electron net 报 `ERR_INVALID_ARGUMENT`。
- 知乎图片：远程图走 `zhuanlan.zhihu.com/api/uploaded_images`，本地图走 `api.zhihu.com/images` + OSS V1 签名；已存在的图片（`state:1`）需轮询 `api.zhihu.com/images/{id}` 直到返回 `original_hash`。
- 今日头条：`mp.toutiao.com/mp/agw/article/publish?source=mp&type=article`（form-urlencoded，`X-CSRFToken` 取自 cookie `csrftoken`，`save=1` 存草稿），正文 `<p>` 需补递增 `data-track`；图片走 `mp/agw/article_material/photo/upload_picture`（字段 `upfile`）。无 `_signature` 依赖。
- 开源中国：接口域 `apiv1.oschina.net/oschinapi`（JSON）。登录探测 `GET /user/myDetails`（未登录 `code=40001`）；草稿 `POST /api/draft/save_draft`（正文以 Markdown 提交，`contentType=1`，必填 `catalog`，空分类时先 `POST /blog_catalog/add?name=默认分类`，取 `result.id`）；发布 `POST /blog/web/add`（取 `result` 为博文 id）；分类 `GET /blog_catalog/list_by_user`；图片 `POST /ai/creation/project/uploadDetail`（multipart 字段 `file`，取 `result` 为图片 URL）。**切勿给该平台请求注入 `Origin`/`Referer`**：无论是用 `installHeaderRules`（作用于整个 session，会连带覆盖 `www.oschina.net` 登录页对 `apiv1` 的请求，导致 CORS 失败、微信等第三方登录报 `Network Error`），还是在 `session.fetch` 里手动设 `Referer`（Electron net 校验 referrer 策略，POST 会被 Chromium 直接拦截为 `net::ERR_BLOCKED_BY_CLIENT`）。所有请求保持默认头即可。

## 约定

- 不使用 `window.prompt`（Electron 不支持）；用内联输入或 `window.confirm`。
- 不要添加无关注释；提交前清理未使用导入（lint 会报错）。
