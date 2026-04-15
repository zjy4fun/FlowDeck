import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  resolveAvailableUpdatePlan,
  shouldCloseWindowForAction,
} = require('../dist/test-support/updater-logic.cjs');

test('automatic checks prompt before downloading when a hot-update asset exists', () => {
  const plan = resolveAvailableUpdatePlan({
    manual: false,
    skipped: false,
    hasHotUpdateAsset: true,
    assetInfoIncomplete: false,
  });

  assert.equal(plan.kind, 'prompt-download');
});

test('automatic checks ignore skipped versions', () => {
  const plan = resolveAvailableUpdatePlan({
    manual: false,
    skipped: true,
    hasHotUpdateAsset: true,
    assetInfoIncomplete: false,
  });

  assert.equal(plan.kind, 'skip');
});

test('manual checks open the release page when asset info is incomplete', () => {
  const plan = resolveAvailableUpdatePlan({
    manual: true,
    skipped: false,
    hasHotUpdateAsset: true,
    assetInfoIncomplete: true,
  });

  assert.equal(plan.kind, 'prompt-open-release');
});

test('download action keeps the update window alive for progress state transitions', () => {
  assert.equal(shouldCloseWindowForAction('download'), false);
});

test('dismissal actions still close the update window', () => {
  assert.equal(shouldCloseWindowForAction('close'), true);
  assert.equal(shouldCloseWindowForAction('skip-version'), true);
  assert.equal(shouldCloseWindowForAction('open-release'), true);
});
