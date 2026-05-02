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

test('release notes include the macOS Gatekeeper recovery command', () => {
  const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
  assert.match(workflow, /macOS "Cannot Open" Fix/);
  assert.match(workflow, /xattr -rd com\.apple\.quarantine \/Applications\/FlowDeck\.app/);
});
