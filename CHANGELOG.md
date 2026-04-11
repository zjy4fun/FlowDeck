# Changelog

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
