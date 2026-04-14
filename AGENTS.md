# Repository Guidelines

## Project Structure & Module Organization
`src/main/` contains the Electron main-process code, including window creation, PTY lifecycle, and settings persistence. `src/preload/` exposes the safe bridge used by the renderer. `src/renderer/` holds the UI shell, pane and tab logic, state management, and `styles.css`. Build output goes to `dist/` and should be treated as generated. Packaging is configured in `electron-builder.yml`; supporting scripts live in `scripts/`; demo assets live in `artifacts/` and `origin_assets/`.

## Build, Test, and Development Commands
Use `pnpm install` once to install dependencies. `pnpm start` builds via `scripts/build.mjs` and launches the Electron prototype. `pnpm build` performs the TypeScript/esbuild bundle only. `FLOWDECK_CAPTURE=1 pnpm start` launches capture mode and writes `/tmp/flowdeck-prototype.png`. `pnpm pack` creates an unpacked app bundle, and `pnpm dist` creates distributable packages with `electron-builder`.

## Coding Style & Naming Conventions
This project is TypeScript-first with `strict` mode enabled in [tsconfig.json](/Users/z/projects/Vibe99-1/tsconfig.json). Follow the existing style: 2-space indentation, semicolons, single quotes, and small focused modules. Use `camelCase` for functions and variables, `PascalCase` for types/classes, and kebab-case for filenames such as `pty-manager.ts` and `settings-store.ts`. Keep renderer modules narrowly scoped and prefer explicit imports over large shared utility files. There is no dedicated formatter configured, so match the surrounding file exactly.

## Testing Guidelines
There is currently no automated test suite or coverage gate in `package.json`. For changes, run `pnpm build` as the minimum verification step. For UI or terminal behavior, also validate with `pnpm start`; use `FLOWDECK_CAPTURE=1 pnpm start` when a static render is useful for review. When adding tests later, place them beside the relevant module or under a dedicated `tests/` directory and name them after the unit under test, for example `settings-store.test.ts`.

## Commit & Pull Request Guidelines
Recent commits use short, imperative subjects such as `Sanitize persisted settings on load` and `Harden settings normalization for load and save`. Keep commit titles concise, present-tense, and behavior-focused. PRs should explain the user-visible change, note verification steps, and link the relevant issue if one exists. Include screenshots or captured renders for renderer/layout changes, especially when tab, pane, or settings behavior changes.
