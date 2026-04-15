import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'fs';

mkdirSync('dist/main', { recursive: true });
mkdirSync('dist/preload', { recursive: true });
mkdirSync('dist/renderer', { recursive: true });

const shared = { bundle: true, sourcemap: true, logLevel: 'info' };

await Promise.all([
  // Main process
  esbuild.build({
    ...shared,
    entryPoints: ['src/main/index.ts'],
    platform: 'node',
    target: 'node20',
    outfile: 'dist/main/index.js',
    external: ['electron', 'node-pty', 'original-fs'],
    format: 'cjs',
  }),

  // Test support helpers
  esbuild.build({
    ...shared,
    entryPoints: ['src/main/updater-logic.ts'],
    platform: 'node',
    target: 'node20',
    outfile: 'dist/test-support/updater-logic.cjs',
    format: 'cjs',
  }),

  // Preload script
  esbuild.build({
    ...shared,
    entryPoints: ['src/preload/index.ts'],
    platform: 'node',
    target: 'node20',
    outfile: 'dist/preload/index.js',
    external: ['electron'],
    format: 'cjs',
  }),

  // Renderer JS
  esbuild.build({
    ...shared,
    entryPoints: ['src/renderer/index.ts'],
    platform: 'browser',
    target: 'chrome120',
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
cpSync('src/renderer/settings-window.html', 'dist/renderer/settings-window.html');
cpSync('src/renderer/update-window.html', 'dist/renderer/update-window.html');

// Copy shell integration scripts
cpSync('src/main/shell-integration', 'dist/main/shell-integration', { recursive: true });

console.log('Build complete.');
