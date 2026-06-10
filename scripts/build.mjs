import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'fs';

const isDevBuild = process.argv.includes('--dev') || process.env.FLOWDECK_DEV_BUILD === '1';
const nodeTarget = 'node22';
const browserTarget = 'chrome136';
const shared = {
  bundle: true,
  sourcemap: isDevBuild,
  minify: !isDevBuild,
  drop: isDevBuild ? [] : ['debugger'],
  legalComments: 'none',
  logLevel: 'info',
};

mkdirSync('dist/main', { recursive: true });
mkdirSync('dist/preload', { recursive: true });
mkdirSync('dist/renderer', { recursive: true });

await Promise.all([
  // Main process
  esbuild.build({
    ...shared,
    entryPoints: ['src/main/index.ts'],
    platform: 'node',
    target: nodeTarget,
    outfile: 'dist/main/index.js',
    external: ['electron', 'node-pty', 'original-fs'],
    format: 'cjs',
  }),

  // Test support helpers
  esbuild.build({
    ...shared,
    entryPoints: ['src/main/updater-logic.ts'],
    platform: 'node',
    target: nodeTarget,
    outfile: 'dist/test-support/updater-logic.cjs',
    format: 'cjs',
  }),
  esbuild.build({
    ...shared,
    entryPoints: ['src/main/terminal-data-batcher.ts'],
    platform: 'node',
    target: nodeTarget,
    outfile: 'dist/test-support/terminal-data-batcher.cjs',
    format: 'cjs',
  }),
  esbuild.build({
    ...shared,
    entryPoints: ['src/renderer/reactivation-controller.ts'],
    platform: 'node',
    target: nodeTarget,
    outfile: 'dist/test-support/reactivation-controller.cjs',
    format: 'cjs',
  }),
  esbuild.build({
    ...shared,
    entryPoints: ['src/main/window-lifecycle.ts'],
    platform: 'node',
    target: nodeTarget,
    outfile: 'dist/test-support/window-lifecycle.cjs',
    format: 'cjs',
  }),
  esbuild.build({
    ...shared,
    entryPoints: ['src/main/window-options.ts'],
    platform: 'node',
    target: nodeTarget,
    outfile: 'dist/test-support/window-options.cjs',
    format: 'cjs',
  }),
  esbuild.build({
    ...shared,
    entryPoints: ['src/main/about-dialog.ts'],
    platform: 'node',
    target: nodeTarget,
    outfile: 'dist/test-support/about-dialog.cjs',
    external: ['electron'],
    format: 'cjs',
  }),
  esbuild.build({
    ...shared,
    entryPoints: ['src/main/terminal-context-menu.ts'],
    platform: 'node',
    target: nodeTarget,
    outfile: 'dist/test-support/terminal-context-menu.cjs',
    format: 'cjs',
  }),

  // Preload script
  esbuild.build({
    ...shared,
    entryPoints: ['src/preload/index.ts'],
    platform: 'node',
    target: nodeTarget,
    outfile: 'dist/preload/index.js',
    external: ['electron'],
    format: 'cjs',
  }),

  // Renderer JS
  esbuild.build({
    ...shared,
    entryPoints: ['src/renderer/index.ts'],
    platform: 'browser',
    target: browserTarget,
    outfile: 'dist/renderer/renderer.js',
    format: 'esm',
  }),

  // Renderer CSS (bundles @import for xterm.css)
  esbuild.build({
    ...shared,
    entryPoints: ['src/renderer/styles.css'],
    bundle: true,
    outfile: 'dist/renderer/styles.css',
  }),
]);

// Copy static HTML
cpSync('src/renderer/index.html', 'dist/renderer/index.html');
cpSync('src/renderer/update-window.html', 'dist/renderer/update-window.html');

// Copy shell integration scripts
cpSync('src/main/shell-integration', 'dist/main/shell-integration', { recursive: true });

console.log('Build complete.');
