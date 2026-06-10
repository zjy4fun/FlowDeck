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
  let now = 0;

  const batcher = createTerminalDataBatcher({
    flushDelayMs: 16,
    send: (paneId, data) => {
      sent.push({ paneId, data });
    },
    schedule: (callback) => {
      scheduled.push(callback);
      return scheduled.length;
    },
    cancel: () => {},
    now: () => now,
  });

  batcher.queue('pane-1', 'first');
  assert.deepEqual(sent, [{ paneId: 'pane-1', data: 'first' }]);

  now = 4;
  batcher.queue('pane-1', 'hello');
  batcher.queue('pane-1', ' world');

  assert.equal(sent.length, 1);
  assert.equal(scheduled.length, 1);

  now = 16;
  scheduled[0]();

  assert.deepEqual(sent, [
    { paneId: 'pane-1', data: 'first' },
    { paneId: 'pane-1', data: 'hello world' },
  ]);
});

test('terminal data batcher keeps panes isolated and supports immediate flush', () => {
  const sent = [];
  const scheduled = [];
  const cancelled = [];
  let now = 0;

  const batcher = createTerminalDataBatcher({
    flushDelayMs: 16,
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
    now: () => now,
  });

  batcher.queue('pane-1', 'a');
  now = 4;
  batcher.queue('pane-1', 'aa');
  batcher.queue('pane-2', 'b');
  batcher.flushPane('pane-1');

  assert.deepEqual(sent, [
    { paneId: 'pane-1', data: 'a' },
    { paneId: 'pane-2', data: 'b' },
    { paneId: 'pane-1', data: 'aa' },
  ]);

  assert.deepEqual(cancelled, [1]);
});

test('terminal data batcher flushes the leading chunk immediately', () => {
  const sent = [];

  const batcher = createTerminalDataBatcher({
    send: (paneId, data) => {
      sent.push({ paneId, data });
    },
  });

  batcher.queue('pane-1', 'a');

  assert.deepEqual(sent, [{ paneId: 'pane-1', data: 'a' }]);
});

test('terminal data batcher caps a single pending batch by byte size', () => {
  const sent = [];
  const cancelled = [];
  let now = 0;

  const batcher = createTerminalDataBatcher({
    flushDelayMs: 16,
    maxBatchBytes: 5,
    send: (paneId, data) => {
      sent.push({ paneId, data });
    },
    schedule: () => 7,
    cancel: (handle) => {
      cancelled.push(handle);
    },
    now: () => now,
  });

  batcher.queue('pane-1', 'seed');
  now = 4;
  batcher.queue('pane-1', 'ab');
  batcher.queue('pane-1', 'cde');

  assert.deepEqual(sent, [
    { paneId: 'pane-1', data: 'seed' },
    { paneId: 'pane-1', data: 'abcde' },
  ]);
  assert.deepEqual(cancelled, [7]);
});
