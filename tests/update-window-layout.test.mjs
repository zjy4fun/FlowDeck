import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const updateWindowHtml = readFileSync(join(rootDir, 'src/renderer/update-window.html'), 'utf8');
const updaterSource = readFileSync(join(rootDir, 'src/main/updater.ts'), 'utf8');

test('macOS update window reserves enough space below traffic-light controls', () => {
  assert.match(updateWindowHtml, /document\.documentElement\.dataset\.platform = bridge\.platform/);
  assert.match(updateWindowHtml, /html\[data-platform='darwin'\] body \{\s*padding-top: 66px;/);
});

test('compact update window reserves enough height for bottom actions', () => {
  const sizeMatch = updaterSource.match(/COMPACT_UPDATE_WINDOW_SIZE = \{ width: 480, height: (?<height>\d+) \}/);
  assert.ok(sizeMatch?.groups?.height, 'expected compact update window size constant');
  assert.ok(Number(sizeMatch.groups.height) >= 240, 'compact window must not clip action buttons');
  assert.match(updateWindowHtml, /grid-template-rows:\s*minmax\(0, 1fr\) auto;/);
  assert.match(updateWindowHtml, /\.actions \{[^}]*min-height:\s*47px;/s);
});
