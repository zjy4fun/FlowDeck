# Changelog

## v0.4.9

- Fix duplicate/ghost vertical divider lines between panes by drawing each shared pane boundary only once
- Fix Codex footer usage status so low-but-nonzero session usage is not shown as an exact 100% remaining

## v0.4.8

- Show the quit confirmation dialog when quitting FlowDeck with `Cmd+Q`

## v0.4.5

- Fix terminal input getting stuck after FlowDeck stays in the background for a while and then returns to the foreground
- Restore terminal focus reliably when switching sessions after a background resume

## v0.4.3

- Fix macOS in-app update apply flow by replacing `app.asar` from a detached helper after FlowDeck fully exits
- Fix bundled app version metadata so the installed app reports `0.4.3` correctly after updating
- Show a clear notice when a downloaded update is still pending installation

## v0.4.2

- Fix update window vertical center style

## v0.4.1

- Fix pane boundary rendering rules so focused-session accent controls both adjacent borders
- Remove residual vertical white line near the terminal scrollbar/overview area
- Narrow terminal scrollbar area for cleaner session edges
- Strengthen tab "working" animation and fix left-side clipping in busy indicator

## v0.3.10

- Handle GitHub API 403/429 during update checks with a releases-page fallback

## v0.3.9

- Make single-session layout fill the entire stage width

## v0.3.8

- Add usage quota tracking in status bar with periodic refresh
- Add configurable usage source (`Codex` / `Claude Code`) in settings
- Add update window flow with progress, cancellation, and restart controls
- Improve initial session accent colors for better visual distinction
- Update README docs for latest features and macOS/Windows release outputs

## v0.3.5

- Fix asar hot-update: use original-fs to bypass Electron's asar interception

## v0.3.4

- Test hot-update mechanism

## v0.3.3

- Replace electron-updater with custom asar hot-update mechanism
- Only download app.asar (~11MB) instead of full installer (~100MB)
- No macOS code signing required for hot updates
- Release workflow now extracts and uploads app.asar as release asset

## v0.3.2

- Fix release workflow to include auto-update metadata files (latest-mac.yml, latest.yml)

## v0.3.1

- Add auto-update support with electron-updater
- Add "Check for Updates" menu item
- Silent update check on app launch, auto-download and prompt to restart

## v0.3.0

- Update UI theme to warm dark palette (Dracula-inspired)
- Reduce pane border width and remove heavy box-shadow
- Fix terminal bottom black bar by unifying background colors
- Improve tab focus styling with subtle highlight
- Center and resize README icon
- Update brand assets and app icons
- Enhance release workflow and CI configuration
- Improve settings window and lifecycle management
- Add keyboard navigation enhancements

## v0.2.2

- Improve zsh integration by handling original ZDOTDIR restoration
- Enhance shell integration by resolving directory paths and checking for configuration files
- Implement settings change notification and reload functionality

## v0.2.1

- Add shell integration scripts for bash and zsh
- Fix CI configuration to reflect macOS-only support
- Implement pane actions controller and enhance pane management

## v0.2.0

- Initial FlowDeck prototype
- Real PTY-backed terminals powered by node-pty
- Multi-pane workspace with add, close, focus, and drag-reorder
- Inline tab renaming with terminal title fallback
- Keyboard navigation mode with Ctrl+B
- Renderer settings for font size, pane width, and pane opacity
- Capture mode for static snapshots
- macOS packaging via electron-builder
