# md-publish

将 Markdown 文档一键发布到 **微信公众号 / 稀土掘金 / 知乎 / 今日头条** 的跨平台桌面客户端（macOS & Windows）。

基于 Electron + React + TypeScript。支持文档管理、编辑、实时预览，以及通过内嵌登录窗口复用各平台登录态进行发布（默认存草稿）。

## 功能

- 本地 Markdown 工作区（正文即普通 `.md` 文件，可用 Git 管理）
- 文档管理：新建 / 重命名 / 删除 / 搜索，文件外部变更自动同步
- 编辑器：CodeMirror 6（语法高亮、快捷键）
- 实时预览：markdown-it + highlight.js，GitHub 风格排版
- 平台适配器：微信公众号 / 掘金 / 知乎 / 今日头条（Cookie 登录态，草稿优先）
- 发布记录持久化（SQLite）

## 技术栈

- Electron 44 + electron-vite 5 + Vite 7
- React 19 + TypeScript 5.9 + TailwindCSS 3
- CodeMirror 6、markdown-it、highlight.js、node-html-parser
- better-sqlite3 v13（N-API，跨平台预编译，无需 electron-rebuild）
- 存储：本地 `.md` 文件 + SQLite 元数据索引

## 开发

```bash
npm install
npm run dev        # 启动开发模式
npm run typecheck  # 类型检查（main + renderer）
npm run lint       # ESLint
npm run build      # 构建
```

> **注意**：较新的 npm 默认会拦截第三方 install 脚本。若 `npm install` 后
> Electron 二进制缺失，请运行 `node node_modules/electron/install.js`，或执行
> 项目自带的 `npm run postinstall`。

## 打包

```bash
npm run pack:mac   # macOS dmg (arm64 + x64)
npm run pack:win   # Windows nsis (x64 + arm64)
npm run pack:mas   # macOS App Store 包 (.pkg)
```

发布流程通过 GitHub Actions（`.github/workflows/build.yml`）在各自平台分别构建。

## 发布到 Mac App Store（MAS）

`npm run pack:mas` 会产出 App Store 用的 `.pkg`，但**必须**先在发布机具备以下条件，否则会报
`cannot find valid "Apple Distribution, 3rd Party Mac Developer Application" identity`：

1. **Apple Developer Program** 账号（付费）。
2. **证书**（钥匙串登录）：
   - `Apple Distribution`（或 `3rd Party Mac Developer Application`）—— 签名 App
   - `3rd Party Mac Developer Installer` —— 签名 `.pkg`
3. **App Store Connect** 应用记录，Bundle ID 必须为 `com.mdpublish.app`（见 `electron-builder.yml: appId`）。
4. **Mac App Store 描述文件**（`.provisionprofile`），并在 `electron-builder.yml` 配置：
   ```yaml
   mac:
     provisioningProfile: build/md-publish.provisionprofile
   ```
5. **应用图标**：`build/icon.png`（1024×1024，含透明通道），否则会使用默认 Electron 图标而被审核拒绝。
6. 可选：用环境变量提供证书（CI 场景）：`CSC_LINK`（.p12 base64/路径）、`CSC_KEY_PASSWORD`、`CSC_NAME`。

打包与上传：

```bash
npm run pack:mas
# 上传（App 专用密码，或使用 Transporter.app）
xcrun altool --upload-app -f dist/*.pkg -t macos -u "<appleId>" -p "<app-specific-password>"
```

> ✅ **沙箱文件访问已支持**：MAS 沙箱下通过「选择文件夹」取得的权限重启后会失效，应用会为工作区创建
> **security-scoped bookmark** 并持久化，启动时自动恢复访问（原生模块 `native/mac-bookmark`）。
> `pack:mac` / `pack:mas` 会先编译该原生模块（macOS），并以 `extraResources` 打进 `Resources/mac-bookmark/`。
> 非 macOS 或模块缺失时自动降级为普通路径访问。
>
> 若不发布 App Store，推荐使用 **Developer ID 签名 + 公证（notarize）的 dmg** 分发：无需沙箱，
> 工作区文件访问不受限制。

## 目录结构

```
src/
  shared/     # 类型、IPC 契约、markdown 管线（main/renderer 共用）
  preload/    # contextBridge 暴露 window.api
  main/
    db/       # better-sqlite3 + 迁移
    fs/       # 工作区、文档 CRUD、文件监听
    markdown/ # 文章渲染、微信内联样式
    adapters/ # 平台适配器（base / session-manager / wechat / juejin / zhihu / toutiao）
    publish.ts
    ipc/
  renderer/   # React UI
build/        # 打包资源（entitlements、图标、描述文件）
```

## 平台说明

| 平台 | 方式 | 说明 |
| --- | --- | --- |
| 微信公众号 | Cookie（`mp.weixin.qq.com` 后台 Web 接口） | 默认创建草稿，最终群发仍需人工确认；依赖后台内部接口，可能随改版失效 |
| 稀土掘金 | Cookie（`api.juejin.cn`） | 默认存草稿，可切换为直接发布 |
| 知乎 | Cookie（`zhuanlan.zhihu.com`） | **实验性**：接口风控较重，部分请求需要 `x-zse-96` 签名，可能失败 |
| 今日头条 | Cookie（`mp.toutiao.com`） | 默认保存草稿；使用 `X-CSRFToken`，正文 `<p>` 会补 `data-track`，图片上传头条图床 |

每个平台使用独立的 Electron `session` 分区（`persist:mdpublish-<id>`），登录态由 Chromium
加密持久化，互不干扰。平台适配器均为社区逆向实现，非官方 API，接口可能随时变化。

## License

MIT
