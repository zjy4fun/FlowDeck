import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const updateWindowHtml = readFileSync(join(rootDir, 'src/renderer/update-window.html'), 'utf8');

test('macOS update window reserves enough space below traffic-light controls', () => {
  assert.match(updateWindowHtml, /document\.documentElement\.dataset\.platform = bridge\.platform/);
  assert.match(updateWindowHtml, /html\[data-platform='darwin'\] body \{\s*padding-top: 66px;/);
});
