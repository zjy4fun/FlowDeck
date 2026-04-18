import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createReactivationController,
} = require('../dist/test-support/reactivation-controller.cjs');

test('reactivation controller refocuses immediately and defers usage refresh', () => {
  const calls = [];
  const timers = [];

  const controller = createReactivationController({
    debounceMs: 250,
    usageRefreshDelayMs: 300,
    now: () => 1000,
    onRefocusTerminal: () => calls.push('focus'),
    onRefreshUsage: () => calls.push('refresh'),
    scheduleTimeout: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearScheduledTimeout: () => {},
  });

  controller.handleWindowReactivated();

  assert.deepEqual(calls, ['focus']);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 300);

  timers[0].callback();

  assert.deepEqual(calls, ['focus', 'refresh']);
});

test('reactivation controller debounces duplicate events and replaces pending refresh timers', () => {
  const calls = [];
  const timers = [];
  const cancelled = [];
  let nowValue = 1000;

  const controller = createReactivationController({
    debounceMs: 250,
    usageRefreshDelayMs: 300,
    now: () => nowValue,
    onRefocusTerminal: () => calls.push('focus'),
    onRefreshUsage: () => calls.push('refresh'),
    scheduleTimeout: (callback, delay) => {
      const handle = { callback, delay, id: timers.length + 1 };
      timers.push(handle);
      return handle;
    },
    clearScheduledTimeout: (handle) => {
      cancelled.push(handle.id);
    },
  });

  controller.handleWindowReactivated();
  nowValue = 1100;
  controller.handleWindowReactivated();
  nowValue = 1400;
  controller.handleWindowReactivated();

  assert.deepEqual(calls, ['focus', 'focus']);
  assert.deepEqual(cancelled, [1]);
  assert.equal(timers.length, 2);

  timers[1].callback();

  assert.deepEqual(calls, ['focus', 'focus', 'refresh']);
});
