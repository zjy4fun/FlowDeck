import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));

function readProjectFile(relativePath) {
  return readFileSync(join(rootDir, relativePath), 'utf8');
}

test('renderer settings UI no longer exposes a usage source selector', () => {
  const html = readProjectFile('src/renderer/index.html');

  assert.equal(html.includes('usage-provider-input'), false);
  assert.equal(html.includes('Usage source'), false);
});

test('renderer status bar no longer references usage quota state', () => {
  const source = readProjectFile('src/renderer/app.ts');

  assert.equal(source.includes('loadUsageQuota'), false);
  assert.equal(source.includes('UsageQuotaSnapshot'), false);
  assert.equal(source.includes('statusHint'), false);
});

test('main and preload processes no longer expose usage quota IPC', () => {
  const preload = readProjectFile('src/preload/index.ts');
  const main = readProjectFile('src/main/index.ts');

  assert.equal(preload.includes('loadUsageQuota'), false);
  assert.equal(preload.includes('flowdeck:usage-quota-load'), false);
  assert.equal(main.includes('UsageQuotaSnapshot'), false);
  assert.equal(main.includes('registerUsageQuotaHandlers'), false);
  assert.equal(main.includes('flowdeck:usage-quota-load'), false);
});
