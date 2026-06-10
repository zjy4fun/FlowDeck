# Changelog

## v0.4.54

### Performance

- Add terminal data backpressure between the renderer and PTY sessions, pausing high-volume output until xterm has written enough data and acknowledging completed writes in byte batches.
- Cap terminal IPC batches by byte size and switch batching to leading-plus-trailing throttling so interactive echo is sent immediately while burst output remains coalesced.
- Send terminal write and resize IPC messages fire-and-forget to avoid per-keystroke invoke/reply overhead.
- Avoid blocking the main process during quit confirmation by using the asynchronous message box API with a single pending confirmation.
- Detect developer project context with one asynchronous upward marker scan instead of repeated synchronous filesystem traversals.
- Reduce startup work by showing the main window after ready-to-show, lazily loading node-pty on first terminal creation, overlapping settings load with renderer setup, and staggering initial terminal session startup.
- Reduce renderer hot-path work for terminal data, pane resize, tab busy indicators, toolbar renders, link detection, settings input, and terminal refits.
- Stream update downloads to disk with throttled progress updates instead of buffering the entire asset in memory.

### Packaging

- Minify production bundles, disable packaged source maps, target Electron 36 runtimes, and exclude test support and map files from app.asar.
- Remove unused xterm WebGL addon packaging and keep xterm browser-renderer dependencies out of production node_modules.
- Add a test script and run the test suite in CI after build and type-check.

### Fixed

- Scope PTY sessions by window and destroy them when their owning webContents is destroyed or reloaded, preventing leaked shell processes and pane ID collisions across windows.
- Serialize settings writes through temp-file renames and flush the latest settings synchronously during quit.
- Avoid stale update-window action resolvers and redundant native resize calls in the updater.

## v0.4.53

- Reflow terminal output when a session pane grows from narrow to wide (e.g. on focus), so text rewraps to the full width instead of staying wrapped at the old, narrower column count. Each pane now observes its own size and refits the terminal (and the backing PTY) after the layout settles, covering focus changes, window resizes, and split-handle drags.

## v0.4.52

- Fix unreadable light-theme terminal text by remapping the washed-out ANSI white/bright-white greys (~1.5:1 contrast) to darker Latte tones, so code blocks, dim labels, and prompts stay legible
- Lift the dark-theme dim/"bright black" tone so comments and de-emphasized text clear ~2.9:1 instead of ~2.2:1
- Add a terminal theme contrast regression test

## v0.4.51

- Prevent terminal row content from visually overlapping the next row when scrolling scrollback during streaming output
- Keep horizontal CJK fallback glyph overhang while clipping vertical row spill

## v0.4.50

- Fix remaining Chinese/CJK terminal glyph clipping by allowing xterm DOM rows to show fallback font overhang
- Add regression coverage for CJK DOM renderer overflow handling

## v0.4.49

- Increase terminal right-edge safety spacing so long CJK and mixed-language lines wrap before glyphs are clipped
- Update terminal layout regression coverage for the wider safety margin

## v0.4.48

- Fit overlapped terminal panes to their visible width so text no longer renders under the pane to the right
- Leave a trailing terminal safety column to prevent right-edge glyphs from being clipped by rounding or font metrics
- Add regression coverage for occluded pane fit and terminal right-edge safety

## v0.4.47

- Fix terminal line wrapping so right-edge characters remain visible instead of being clipped by the pane gutter
- Keep the terminal gutter aligned with xterm's fit calculations to prevent long CJK lines from wrapping too late
- Add a regression test for the terminal gutter and viewport layout

## v0.4.46

- Show the full generated AI command in an expanded hover preview over the result field
- Paste the generated command into the current terminal session when clicking the AI result field without executing it
- Keep the AI result visible on narrower layouts so hover preview and paste remain available

## v0.4.45

- Fix AI Mode command generation in GUI-launched macOS apps by invoking Codex with the bundled local Node binary instead of relying on PATH
- Prepend the local Node directory to the Codex child process PATH so the Codex shim works outside a login shell
- Show the underlying AI generation error instead of only Electron's remote-method wrapper message

## v0.4.44

- Fix AI Mode command generation with newer Codex CLI versions by removing the deprecated approval flag
- Keep Codex command generation in read-only sandbox mode while writing the final command to a temporary output file

## v0.4.43

- Fix AI Mode prompt input losing focus while typing, especially with Chinese IME composition
- Avoid replacing the prompt input DOM node on every keystroke so voice dictation does not duplicate text
- Keep Generate and Run button state in sync without rerendering the active input field

## v0.4.42

- Add AI Mode as a persistent setting that shows a natural-language command generator above every session
- Use local Codex from the Electron main process to turn user descriptions into shell commands
- Let generated commands be reviewed in the toolbar and run directly in the active terminal session
- Fix PTY environment typing so TypeScript validation passes

## v0.4.41

- Fix the compact macOS update window so bottom action buttons remain fully visible during downloads
- Reserve explicit layout space for update actions to prevent clipping in the hidden-titlebar window

## v0.4.40

- Fix terminal Unicode rendering for CJK, box-drawing, special symbols, emoji, and Nerd Font glyphs by using a broader fallback font stack
- Disable the xterm WebGL glyph atlas so browser/platform font fallback can render missing glyphs correctly
- Default PTY sessions to a UTF-8 locale when launched from sparse GUI environments

## v0.4.39

- Fix macOS update window layout so traffic-light controls no longer overlap the app icon
- Increase macOS update window height so restart and action buttons remain visible

## v0.4.38

- Add Command/Ctrl-click URL opening in terminal panes for hovered HTTP(S) links
- Validate external URL open requests so only HTTP(S) links can be launched

## v0.4.37

- Fix TypeScript compilation errors for window maximize/restore functionality
- Fix update window layout to prevent content overlap between progress bar and buttons

## v0.4.36

- Add double-click header to maximize/restore window functionality
- Enhance single-tab header mode with full window drag support

## v0.4.35

- Add "Search" to terminal right-click menu, opening a Google search for the selected text in the default browser

## v0.4.34

- Add single-tab header mode that shows only the focused tab and makes the entire header area a window drag handle

## v0.4.33

- Re-release the terminal context menu feature with the missing helper and regression test files included
- Keep the right-click Copy, Paste, and Translate Selection behavior from v0.4.32

## v0.4.32

- Add a terminal right-click menu with Copy and Paste actions
- Add Translate Selection for selected terminal text, opening Google Translate to Chinese
- Route paste through the existing renderer-to-PTY bridge and add context-menu helper tests

## v0.4.31

- Keep Developer Mode script controls interactive by handling toolbar clicks before pane focus rerenders
- Allow the native script dropdown to stay open while still preventing underlying pane click handlers from stealing focus
- Fix Run/Stop/Restart toolbar actions so script commands are reliably written to the active terminal pane

## v0.4.30

- Fix hot-update downloads when GitHub Release asset metadata falls back to the direct `app.asar` URL
- Follow GitHub release asset redirects while staging `app.asar` updates
- Use the installed `app.asar` package version for update checks so hot-updated builds do not keep reporting the old shell version

## v0.4.29

- Restore the Settings gear button in the tab bar directly to the right of the rendered add-tab button
- Keep the dynamic add-tab control visible while hiding only the legacy static fallback button
- Add a regression test to protect the add-tab and Settings button placement

## v0.4.28

- Add Developer Mode as a persistent setting in the gear-triggered floating Settings panel
- Show a per-session developer toolbar with project script detection, Run/Stop/Restart controls, and compact repo status chips
- Remove the independent Settings window and migrate settings into the main window panel

## v0.4.27

- Restore vertical terminal scrollback so mouse-wheel scrolling can reveal previous output history
- Keep horizontal terminal overflow hidden to avoid layout bleed
- Add a regression test for the terminal viewport scroll behavior

## v0.4.26

- Add a Linux/Windows Help > About FlowDeck menu item that shows the current app version
- Keep macOS using the native About panel while giving non-macOS builds an explicit version dialog

## v0.4.25

- Fix Linux fullscreen shortcuts by preserving native window decorations on Linux
- Add Linux app icon metadata and ensure generated assets are available during packaging
- Document Linux release artifacts and improve update/download guidance

## v0.4.23

- Fix macOS reopen behavior after closing the last window by destroying lingering PTY sessions before the next Dock relaunch
- Restore prompt/path output for all panes when FlowDeck is reopened, instead of leaving some sessions with only a cursor
- Add a window-lifecycle regression test so the last-window-close cleanup stays protected

## v0.4.22

- Remove the Codex and Claude Code usage footer entirely so the workspace status bar stays focused on the active directory
- Delete the usage-source setting and the main/preload usage-quota IPC plumbing to reduce renderer and main-process complexity
- Simplify window-reactivation behavior so resuming the app only refocuses the active terminal instead of also refreshing provider usage state

## v0.4.21

- Show immediate visual feedback when the user clicks Check for Updates so the app no longer feels idle during the network check
- Reuse the update window for a lightweight "Checking for updates..." state before switching to the final update result
- Close the temporary checking state cleanly before showing "No Updates" or update-check error dialogs

## v0.4.20

- Polish the update-check and update-download dialog styling for a cleaner, flatter layout
- Remove the unnecessary middle boxed panel so the content feels more native and lightweight
- Refine dialog spacing, background treatment, and action button styling for better visual hierarchy

## v0.4.19

- Reduce terminal lag during heavy output by batching PTY data before forwarding it from the Electron main process to the renderer
- Make window reactivation feel smoother by refocusing the active terminal immediately while deferring usage refresh work
- Avoid duplicate terminal refits during background-resume focus recovery and add regression tests for the new batching/reactivation helpers

## v0.4.11

- Store pane width as a responsive ratio so session layouts scale more consistently across different window sizes
- Preserve compatibility with older saved settings by converting legacy pixel-based pane width values on load
- Upgrade GitHub Actions versions in CI and release workflows for newer runner compatibility

## v0.4.10

- Make wide layouts fill the full stage width when all panes can fit
- Gate pane width expansion by stage capacity so narrower layouts keep their existing behavior
- Remove the dedicated `pnpm capture` script and document `FLOWDECK_CAPTURE=1 pnpm start` instead

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
