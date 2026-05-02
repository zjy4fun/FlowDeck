import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('main settings UI is an in-window floating panel with developer mode', () => {
  const html = readFileSync('src/renderer/index.html', 'utf8');
  assert.match(html, /id="settings-panel"/);
  assert.match(html, /id="developer-mode-input"/);
  assert.match(html, /Developer Mode/);
  assert.doesNotMatch(html, /settings-window\.html/);
});

test('independent settings window menu entry is removed', () => {
  const main = readFileSync('src/main/index.ts', 'utf8');
  assert.doesNotMatch(main, /openSettingsWindow/);
  assert.doesNotMatch(main, /Settings\.\.\./);
  assert.doesNotMatch(main, /Preferences\.\.\./);
  assert.doesNotMatch(main, /settings-window\.html/);
});

test('developer toolbar exposes scripts, run controls, and compact repo chip', () => {
  const renderer = readFileSync('src/renderer/developer-tools.ts', 'utf8');
  assert.match(renderer, /devbar-select/);
  assert.match(renderer, /data-dev-action="run"/);
  assert.match(renderer, /data-dev-action="stop"/);
  assert.match(renderer, /data-dev-action="restart"/);
  assert.match(renderer, /devbar-repo/);
});

test('developer toolbar select clicks keep the native menu open without pane rerender', () => {
  const renderer = readFileSync('src/renderer/developer-tools.ts', 'utf8');
  const lifecycle = readFileSync('src/renderer/controllers/lifecycle.ts', 'utf8');

  assert.match(renderer, /action === 'select' && event\.type !== 'change'/);
  assert.match(lifecycle, /dom\.stage\.addEventListener\('click', handleDeveloperToolbarClick, true\)/);
});

test('settings button stays visible immediately to the right of the rendered add button', () => {
  const html = readFileSync('src/renderer/index.html', 'utf8');
  const css = readFileSync('src/renderer/styles.css', 'utf8');
  const tabs = readFileSync('src/renderer/tabs.ts', 'utf8');

  assert.match(html, /<div class="tabs-list" id="tabs-list"><\/div>\s*<div class="tabs-actions">\s*<button class="tabs-add"/);
  assert.match(tabs, /addButton\.className = 'tab-add-slot';/);
  assert.match(tabs, /tabElements\.push\(createAddPaneButton\(\)\);\s*dom\.tabsList\.replaceChildren\(\.\.\.tabElements\);/);
  assert.match(css, /\.tabs-actions \{\s*display: flex;/);
  assert.match(css, /\.tabs-add \{\s*display: none;/);
  assert.doesNotMatch(css, /\.tabs-actions \{\s*display: none;/);
});

test('release notes include the macOS Gatekeeper recovery command', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
  assert.match(workflow, /macOS "Cannot Open" Fix/);
  assert.match(workflow, /xattr -rd com\.apple\.quarantine \/Applications\/FlowDeck\.app/);
});
