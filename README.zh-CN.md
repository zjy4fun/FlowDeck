# FlowDeck

<p align="center">
  <img src="./assets/brand/flowdeck-icon.svg" width="128" alt="FlowDeck icon" />
</p>

面向 agentic coding 的专注型桌面终端工作区，基于 Electron、TypeScript、xterm.js 和 `node-pty` 构建。

[English README](./README.md)

## 项目简介

FlowDeck 是一个以专注、多窗格协作为核心的桌面终端工作区。它使用轻量的 Electron 外壳承载真实 PTY 终端会话，在保持界面紧凑的同时，提供可实际使用的 shell 体验。

## 平台支持

FlowDeck 当前仅支持 macOS。

- 本地开发与运行验证以 macOS 为准。
- CI 构建与类型检查在 macOS runner 上执行。
- 发版产物仅提供 macOS `.dmg` 与 `.zip`。
- 暂不支持 Linux 与 Windows。

## 品牌资源

品牌资源位于 [`assets/brand/`](./assets/brand/)。图标采用三个并列终端面板的设计，分别以橙色、青色和紫色作为标识色，表达在单一工作区中同时运行多个终端会话的核心理念。

## 核心特性

- 基于 `node-pty` 的真实 PTY 终端窗格
- 支持新增、关闭、聚焦、拖拽重排的多窗格工作区
- 支持标签重命名，并可回退显示终端标题
- 提供 `Ctrl+B` 键盘导航模式
- 可调节字体大小、窗格宽度和窗格透明度
- 支持截图模式，输出静态快照到 `/tmp/flowdeck-prototype.png`
- 通过 `electron-builder` 进行 macOS 打包

## 技术栈

- Electron
- TypeScript
- esbuild
- xterm.js
- node-pty

## 项目结构

- `src/main/` Electron 主进程、PTY 生命周期与设置持久化
- `src/preload/` 暴露给渲染层的安全 preload bridge
- `src/renderer/` 应用外壳、窗格与标签行为、状态管理和样式
- `scripts/build.mjs` TypeScript 与 esbuild 的构建入口
- `dist/` 构建产物目录

## 快速开始

### 环境要求

- Node.js 20+
- pnpm 10+

### 安装依赖

```bash
pnpm install
```

### 启动应用

```bash
pnpm start
```

### 仅执行构建

```bash
pnpm build
```

### 生成静态截图

```bash
pnpm capture
```

截图会输出到 `/tmp/flowdeck-prototype.png`。

## 打包

### 生成未打包的应用目录

```bash
pnpm pack
```

### 生成可分发安装包

```bash
pnpm dist
```

当前发布流程只保留 macOS 打包产物。
CI 校验同样固定在 macOS。

## 版本管理与发版

FlowDeck 使用 `bumpp` 管理版本号和发版标签。发版说明维护在 [CHANGELOG.md](./CHANGELOG.md) 中。

### 发版流程

1. 在 `CHANGELOG.md` 中添加新版本的变更说明
2. 执行发版命令：

```bash
pnpm release
```

这条命令会自动完成：

1. 更新项目版本号
2. 创建 git commit
3. 创建 `v*` 格式的 git tag
4. 将 commit 和 tag 推送到 GitHub

当 tag 被推送到 GitHub 后，发布流水线会自动：

- 构建 macOS 安装包
- 上传 `.dmg` 和 `.zip`
- 从 `CHANGELOG.md` 提取变更说明，创建 GitHub Release

### 仅更新版本号（预览）

```bash
pnpm release:dry
```

## macOS 安装说明

如果你从本地 DMG 安装 FlowDeck 时被 macOS 拦截，通常是 Gatekeeper、未公证签名，或者系统权限弹窗导致的。

### “FlowDeck 已损坏”或“无法打开”

如果应用是从互联网下载的，macOS 可能给它打上了隔离属性。可以先移除隔离标记，再重新打开：

```bash
xattr -dr com.apple.quarantine /Applications/FlowDeck.app
```

也可以在 Finder 里右键应用，选择“打开”，然后在弹窗里手动确认一次。

### “无法验证开发者”

这通常表示当前构建没有使用 Apple Developer 身份进行签名或公证。若只是本机测试，可以这样处理：

1. 打开 `系统设置` -> `隐私与安全性`
2. 在页面下方找到应用被阻止的提示
3. 点击 `仍要打开`

或者在终端里执行一次：

```bash
open /Applications/FlowDeck.app
```

### 终端 / Shell 权限问题

FlowDeck 通过 `node-pty` 启动真实 shell 会话。如果终端无法启动，或者访问受保护目录失败，可以检查：

- `系统设置` -> `隐私与安全性` -> `文件与文件夹`
- 如果需要访问更多受保护目录，再检查 `完全磁盘访问权限`

修改权限后，建议彻底退出并重新打开 FlowDeck。

### 在终端里启动 GUI 应用失败（Electron SIGABRT / abort trap）

如果在 FlowDeck 终端中启动 GUI 应用会立刻失败（例如 Electron 项目在 macOS 上启动即 `SIGABRT`），通常是因为 FlowDeck 当前运行在受限/沙箱宿主会话里。

想要和 iTerm 一致的行为，请从正常桌面会话启动 FlowDeck（Finder、Launchpad、Terminal 或 iTerm），不要从受限运行时或 CI 包装环境启动。

### 面向分发版本的建议

如果希望最终分发给普通用户时不再出现这些警告，后续应补齐：

- 使用有效的 Apple Developer ID 进行代码签名
- 提交 Apple notarization
- 在分发前完成 staple

## 验证

最低验证要求：

```bash
pnpm build
```

如果改动涉及 UI 或终端行为，建议再执行：

```bash
pnpm start
```

## 许可证

MIT，详见 [LICENSE](./LICENSE)。
