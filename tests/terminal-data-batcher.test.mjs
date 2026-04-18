import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createTerminalDataBatcher,
} = require('../dist/test-support/terminal-data-batcher.cjs');

test('terminal data batcher coalesces chunks for the same pane until flushed', () => {
  const sent = [];
  const scheduled = [];

  const batcher = createTerminalDataBatcher({
    send: (paneId, data) => {
      sent.push({ paneId, data });
    },
    schedule: (callback) => {
      scheduled.push(callback);
      return scheduled.length;
    },
    cancel: () => {},
  });

  batcher.queue('pane-1', 'hello');
  batcher.queue('pane-1', ' world');

  assert.equal(sent.length, 0);
  assert.equal(scheduled.length, 1);

  scheduled[0]();

  assert.deepEqual(sent, [{ paneId: 'pane-1', data: 'hello world' }]);
});

test('terminal data batcher keeps panes isolated and supports immediate flush', () => {
  const sent = [];
  const scheduled = [];
  const cancelled = [];

  const batcher = createTerminalDataBatcher({
    send: (paneId, data) => {
      sent.push({ paneId, data });
    },
    schedule: (callback) => {
      scheduled.push(callback);
      return scheduled.length;
    },
    cancel: (handle) => {
      cancelled.push(handle);
    },
  });

  batcher.queue('pane-1', 'a');
  batcher.queue('pane-2', 'b');
  batcher.flushPane('pane-1');

  assert.deepEqual(sent, [{ paneId: 'pane-1', data: 'a' }]);

  scheduled[1]();

  assert.deepEqual(sent, [
    { paneId: 'pane-1', data: 'a' },
    { paneId: 'pane-2', data: 'b' },
  ]);
  assert.deepEqual(cancelled, [1]);
});
