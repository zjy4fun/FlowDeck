import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const terminalSource = readFileSync(new URL('../src/renderer/terminal.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
const ptySource = readFileSync(new URL('../src/main/pty-manager.ts', import.meta.url), 'utf8');

test('terminal font stack includes platform fallbacks for CJK and symbols', () => {
  assert.match(terminalSource, /TERMINAL_FONT_FAMILY/);
  assert.match(terminalSource, /PingFang SC/);
  assert.match(terminalSource, /Noto Sans Mono CJK SC/);
  assert.match(terminalSource, /Noto Sans Symbols 2/);
  assert.match(terminalSource, /Apple Color Emoji/);

  assert.match(styles, /--mono-font-family:/);
  assert.match(styles, /\.terminal-host \.xterm \{[^}]*font-family:\s*var\(--mono-font-family\);/s);
});

test('terminal renderer avoids WebGL glyph atlas so browser font fallback works', () => {
  assert.doesNotMatch(terminalSource, /@xterm\/addon-webgl/);
  assert.match(terminalSource, /const webglAddon = null;/);
});

test('terminal DOM renderer allows horizontal CJK overhang while clipping vertical row spill', () => {
  const screenRule = styles.match(/\.terminal-host \.xterm-screen \{(?<body>[^}]+)\}/);
  const rowRule = styles.match(/\.terminal-host \.xterm-rows > div \{(?<body>[^}]+)\}/);

  assert.ok(screenRule, 'expected a terminal screen CSS rule');
  assert.ok(rowRule, 'expected a terminal row CSS rule');
  assert.match(screenRule.groups.body, /overflow-x:\s*visible\s*!important;/);
  assert.match(screenRule.groups.body, /overflow-y:\s*clip\s*!important;/);
  assert.match(rowRule.groups.body, /overflow-x:\s*visible\s*!important;/);
  assert.match(rowRule.groups.body, /overflow-y:\s*clip\s*!important;/);
});

test('pty sessions default to a UTF-8 locale for Unicode output', () => {
  assert.match(ptySource, /nextEnv\.LANG = 'en_US\.UTF-8'/);
  assert.match(ptySource, /nextEnv\.LC_CTYPE = 'en_US\.UTF-8'/);
  assert.match(ptySource, /isUtf8Locale/);
});
