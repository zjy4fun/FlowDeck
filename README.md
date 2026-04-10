# FlowDeck

Focus-first desktop terminal workspace for agentic coding, built with Electron, TypeScript, xterm.js, and `node-pty`.

[中文文档](./README.zh-CN.md)

## Overview

FlowDeck is a desktop terminal workspace designed for focused, pane-based coding sessions. It combines a compact Electron shell with PTY-backed terminals so the UI stays lightweight while still running real shell sessions.

## Highlights

- Real PTY-backed terminals powered by `node-pty`
- Multi-pane workspace with add, close, focus, and drag-reorder interactions
- Inline tab renaming with terminal title fallback
- Keyboard navigation mode with `Ctrl+B`
- Renderer settings for font size, pane width, and pane opacity
- Capture mode that writes a static snapshot to `/tmp/flowdeck-prototype.png`
- macOS packaging via `electron-builder`

## Tech Stack

- Electron
- TypeScript
- esbuild
- xterm.js
- node-pty

## Project Structure

- `src/main/` Electron main process, PTY lifecycle, and persisted settings
- `src/preload/` safe preload bridge exposed to the renderer
- `src/renderer/` application shell, pane and tab behavior, state, and styles
- `scripts/build.mjs` build entrypoint for the TypeScript and esbuild bundle
- `dist/` generated build output

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 10+

### Install

```bash
pnpm install
```

### Run the app

```bash
pnpm start
```

### Build only

```bash
pnpm build
```

### Capture a static render

```bash
pnpm capture
```

The capture is written to `/tmp/flowdeck-prototype.png`.

## Packaging

### Create an unpacked app bundle

```bash
pnpm pack
```

### Build distributable packages

```bash
pnpm dist
```

The current release workflow only packages macOS artifacts.

## Verification

Minimum verification:

```bash
pnpm build
```

For UI or terminal behavior changes, also run:

```bash
pnpm start
```

## License

MIT. See [LICENSE](./LICENSE).
