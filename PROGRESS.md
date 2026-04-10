# PROGRESS.md

This document records significant project progress with timestamps so the build history stays easy to reconstruct.

- 2026-04-06 22:51:44 CST Product UX Spec drafted
- 2026-04-09 20:27:25 CST Horizontal overlap Electron prototype captured
- 2026-04-09 20:42:22 CST Pane click-focus, slide animation, add-tab, and close-tab interactions added
- 2026-04-09 21:26:02 CST Prototype chrome tightened and right-click tab rename added
- 2026-04-09 21:34:11 CST Prototype restyled to 14px flat chrome with centered tabs and zero rounding
- 2026-04-09 21:51:35 CST Tab drag-reorder and top-right settings for font size and pane opacity added
- 2026-04-09 21:59:52 CST xterm.js integrated into panes with default font size 13, opacity 0.8, and live pane width setting
- 2026-04-09 22:14:34 CST Replaced fake xterm feed with PTY-backed terminals and removed click-triggered redraw flicker
- 2026-04-09 22:18:27 CST Tab click-focus fixed, wide-screen non-overlap layout added, and capture delay increased for xterm paint
- 2026-04-09 22:49:49 CST Fixed Electron preload bridge so tabs and PTY panes initialize again
- 2026-04-09 22:57:45 CST Added double-click rename, Ctrl+B navigation mode, and mode-aware status bar
- 2026-04-09 23:11:47 CST Added future requirements doc and made the focused pane stay fully opaque
- 2026-04-09 23:28:00 CST Added Wails migration evaluation to future requirements
- 2026-04-09 23:46:18 CST Added GPL licensing metadata, repo ignore rules, and a prototype README
