import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  resolveTerminalFocusRecovery,
} = require('../dist/test-support/focus-recovery.cjs');

test('switching to a different pane refits and force-blurs the previously active xterm textarea', () => {
  const strategy = resolveTerminalFocusRecovery({
    previousFocusedPaneId: 'p1',
    nextPaneId: 'p2',
    activeElementClassName: 'xterm-helper-textarea',
    targetTextareaIsActive: false,
  });

  assert.deepEqual(strategy, { refit: true, forceBlur: true });
});

test('re-clicking the already focused pane keeps focus lightweight when its textarea is already active', () => {
  const strategy = resolveTerminalFocusRecovery({
    previousFocusedPaneId: 'p1',
    nextPaneId: 'p1',
    activeElementClassName: 'xterm-helper-textarea',
    targetTextareaIsActive: true,
  });

  assert.deepEqual(strategy, { refit: false, forceBlur: false });
});

test('explicit force-blur requests still win even when staying on the same pane', () => {
  const strategy = resolveTerminalFocusRecovery({
    previousFocusedPaneId: 'p3',
    nextPaneId: 'p3',
    activeElementClassName: 'DIV',
    targetTextareaIsActive: false,
    forceBlur: true,
    refit: true,
  });

  assert.deepEqual(strategy, { refit: true, forceBlur: true });
});
