import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { handleWindowAllClosed } = require('../dist/test-support/window-lifecycle.cjs');

test('window-all-closed destroys lingering sessions on macOS without quitting the app', () => {
  const calls = [];

  handleWindowAllClosed({
    platform: 'darwin',
    destroyAllSessions: () => calls.push('destroy'),
    quit: () => calls.push('quit'),
  });

  assert.deepEqual(calls, ['destroy']);
});

test('window-all-closed destroys lingering sessions and quits on non-macOS platforms', () => {
  const calls = [];

  handleWindowAllClosed({
    platform: 'linux',
    destroyAllSessions: () => calls.push('destroy'),
    quit: () => calls.push('quit'),
  });

  assert.deepEqual(calls, ['destroy', 'quit']);
});
