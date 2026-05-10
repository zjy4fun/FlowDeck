import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createTranslateUrl,
  sanitizeTerminalContextMenuRequest,
} = require('../dist/test-support/terminal-context-menu.cjs');

test('terminal context menu request sanitizer accepts pane and selection text', () => {
  assert.deepEqual(
    sanitizeTerminalContextMenuRequest({ paneId: 'pane-1', selectedText: 'hello' }),
    { paneId: 'pane-1', selectedText: 'hello' },
  );
});

test('terminal context menu request sanitizer falls back to empty selection', () => {
  assert.deepEqual(
    sanitizeTerminalContextMenuRequest({ paneId: 'pane-1', selectedText: 42 }),
    { paneId: 'pane-1', selectedText: '' },
  );
});

test('terminal context menu request sanitizer rejects invalid payloads', () => {
  assert.equal(sanitizeTerminalContextMenuRequest(null), null);
  assert.equal(sanitizeTerminalContextMenuRequest({ paneId: '' }), null);
  assert.equal(sanitizeTerminalContextMenuRequest({ paneId: 1 }), null);
});

test('translate URL targets Chinese and encodes selected text', () => {
  const url = new URL(createTranslateUrl('hello 世界'));
  assert.equal(url.origin, 'https://translate.google.com');
  assert.equal(url.searchParams.get('sl'), 'auto');
  assert.equal(url.searchParams.get('tl'), 'zh-CN');
  assert.equal(url.searchParams.get('text'), 'hello 世界');
  assert.equal(url.searchParams.get('op'), 'translate');
});
