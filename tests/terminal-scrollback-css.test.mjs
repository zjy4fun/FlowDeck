import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');

test('terminal viewport remains vertically scrollable for scrollback history', () => {
  const viewportRule = styles.match(/\.terminal-host \.xterm-viewport \{(?<body>[^}]+)\}/);

  assert.ok(viewportRule, 'expected a terminal viewport CSS rule');
  assert.match(viewportRule.groups.body, /overflow-y:\s*auto\s*!important;/);
  assert.doesNotMatch(viewportRule.groups.body, /overflow:\s*hidden\s*!important;/);
});
