import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createReactivationController,
} = require('../dist/test-support/reactivation-controller.cjs');

test('reactivation controller refocuses immediately on the first activation', () => {
  const calls = [];

  const controller = createReactivationController({
    debounceMs: 250,
    now: () => 1000,
    onRefocusTerminal: () => calls.push('focus'),
  });

  controller.handleWindowReactivated();

  assert.deepEqual(calls, ['focus']);
});

test('reactivation controller debounces duplicate events', () => {
  const calls = [];
  let nowValue = 1000;

  const controller = createReactivationController({
    debounceMs: 250,
    now: () => nowValue,
    onRefocusTerminal: () => calls.push('focus'),
  });

  controller.handleWindowReactivated();
  nowValue = 1100;
  controller.handleWindowReactivated();
  nowValue = 1400;
  controller.handleWindowReactivated();

  assert.deepEqual(calls, ['focus', 'focus']);
});
