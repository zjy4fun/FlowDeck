# FlowDeck

面向 agentic coding 的专注型桌面终端工作区，基于 Electron、TypeScript、xterm.js 和 `node-pty` 构建。

[English README](./README.md)

## 项目简介

FlowDeck 是一个以专注、多窗格协作为核心的桌面终端工作区。它使用轻量的 Electron 外壳承载真实 PTY 终端会话，在保持界面紧凑的同时，提供可实际使用的 shell 体验。

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
