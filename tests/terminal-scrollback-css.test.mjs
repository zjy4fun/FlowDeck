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

test('terminal gutter does not inflate xterm fit width', () => {
  const hostRule = styles.match(/\.terminal-host \{(?<body>[^}]+)\}/);
  const xtermRule = styles.match(/\.terminal-host \.xterm \{(?<body>[^}]+)\}/);
  const viewportRule = styles.match(/\.terminal-host \.xterm-viewport \{(?<body>[^}]+)\}/);

  assert.ok(hostRule, 'expected a terminal host CSS rule');
  assert.ok(xtermRule, 'expected a terminal xterm CSS rule');
  assert.ok(viewportRule, 'expected a terminal viewport CSS rule');

  assert.match(hostRule.groups.body, /--terminal-inline-gutter:\s*6px;/);
  assert.match(hostRule.groups.body, /padding:\s*0;/);
  assert.match(xtermRule.groups.body, /padding:\s*0\s+var\(--terminal-inline-gutter\);/);
  assert.match(viewportRule.groups.body, /left:\s*var\(--terminal-inline-gutter\)\s*!important;/);
  assert.match(viewportRule.groups.body, /right:\s*var\(--terminal-inline-gutter\)\s*!important;/);
});
