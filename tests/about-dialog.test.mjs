import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAboutDialogOptions } = require('../dist/test-support/about-dialog.cjs');

test('about dialog exposes the current application version', () => {
  const options = createAboutDialogOptions({
    appName: 'FlowDeck',
    currentVersion: '0.4.25',
  });

  assert.equal(options.title, 'About FlowDeck');
  assert.equal(options.message, 'FlowDeck');
  assert.equal(options.detail, 'Version 0.4.25');
  assert.deepEqual(options.buttons, ['OK']);
});
