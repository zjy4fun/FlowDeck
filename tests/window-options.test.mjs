import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  getWindowIconPath,
  shouldToggleFullScreenForInput,
} = require('../dist/test-support/window-options.cjs');

test('Linux packaged windows use the extraResources app icon path', () => {
  assert.equal(
    getWindowIconPath({
      platform: 'linux',
      resourcesPath: '/opt/FlowDeck/resources',
      appPath: '/opt/FlowDeck/resources/app.asar',
      isPackaged: true,
    }),
    '/opt/FlowDeck/resources/build/icon.png',
  );
});

test('Linux development windows use the repository icon path', () => {
  assert.equal(
    getWindowIconPath({
      platform: 'linux',
      resourcesPath: '/tmp/electron',
      appPath: '/repo/FlowDeck',
      isPackaged: false,
    }),
    '/repo/FlowDeck/build/icon.png',
  );
});

test('macOS does not set a custom BrowserWindow icon', () => {
  assert.equal(
    getWindowIconPath({
      platform: 'darwin',
      resourcesPath: '/Applications/FlowDeck.app/Contents/Resources',
      appPath: '/Applications/FlowDeck.app/Contents/Resources/app.asar',
      isPackaged: true,
    }),
    undefined,
  );
});

test('F11 toggles fullscreen on Linux and Windows', () => {
  assert.equal(shouldToggleFullScreenForInput({ platform: 'linux', key: 'F11' }), true);
  assert.equal(shouldToggleFullScreenForInput({ platform: 'win32', key: 'F11' }), true);
});

test('Escape exits fullscreen on Linux and Windows only when fullscreen is active', () => {
  assert.equal(
    shouldToggleFullScreenForInput({ platform: 'linux', key: 'Escape', isFullScreen: true }),
    true,
  );
  assert.equal(
    shouldToggleFullScreenForInput({ platform: 'linux', key: 'Escape', isFullScreen: false }),
    false,
  );
});

test('macOS keeps native fullscreen keyboard behavior', () => {
  assert.equal(shouldToggleFullScreenForInput({ platform: 'darwin', key: 'F11' }), false);
  assert.equal(
    shouldToggleFullScreenForInput({ platform: 'darwin', key: 'Escape', isFullScreen: true }),
    false,
  );
});
