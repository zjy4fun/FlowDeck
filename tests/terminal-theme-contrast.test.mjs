import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const terminalSource = readFileSync(
  new URL('../src/renderer/terminal.ts', import.meta.url),
  'utf8',
);

function extractPalette(name) {
  const block = terminalSource.match(
    new RegExp(`const ${name} = \\{(?<body>[\\s\\S]*?)\\n\\};`),
  );
  assert.ok(block, `expected to find ${name}`);

  const palette = {};
  const entryPattern = /(\w+):\s*'(#[0-9a-fA-F]{6})'/g;
  let match;
  while ((match = entryPattern.exec(block.groups.body)) !== null) {
    palette[match[1]] = match[2];
  }
  return palette;
}

function channelLuminance(value) {
  const channel = value / 255;
  return channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex) {
  const red = parseInt(hex.slice(1, 3), 16);
  const green = parseInt(hex.slice(3, 5), 16);
  const blue = parseInt(hex.slice(5, 7), 16);
  return (
    0.2126 * channelLuminance(red) +
    0.7152 * channelLuminance(green) +
    0.0722 * channelLuminance(blue)
  );
}

function contrastRatio(foreground, background) {
  const lighter = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const darker = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  return (lighter + 0.05) / (darker + 0.05);
}

const LIGHT = extractPalette('LIGHT_PALETTE');
const DARK = extractPalette('DARK_PALETTE');

test('light theme greyscale text stays legible on the light background', () => {
  // These greys are commonly used as foreground text (default, dim labels,
  // ANSI white/bright-white). They must clear a readable contrast floor.
  for (const key of ['foreground', 'black', 'brightBlack', 'white', 'brightWhite']) {
    const ratio = contrastRatio(LIGHT[key], LIGHT.background);
    assert.ok(
      ratio >= 3,
      `light ${key} (${LIGHT[key]}) contrast ${ratio.toFixed(2)} is too low`,
    );
  }
});

test('light theme no longer uses the near-invisible pale white greys', () => {
  // Regression guard for the washed-out Surface1/Surface2 values that rendered
  // ANSI white/bright-white text at ~1.5:1 against the light background.
  assert.notEqual(LIGHT.white, '#acb0be');
  assert.notEqual(LIGHT.brightWhite, '#bcc0cc');
  assert.ok(contrastRatio(LIGHT.white, LIGHT.background) >= 3);
  assert.ok(contrastRatio(LIGHT.brightWhite, LIGHT.background) >= 4.5);
});

test('dark theme keeps crisp foreground and a legible dim tone', () => {
  assert.ok(
    contrastRatio(DARK.foreground, DARK.background) >= 7,
    'dark foreground should remain high contrast',
  );
  // Dim / comment text ("bright black") must stay above the prior ~2.2:1.
  assert.ok(
    contrastRatio(DARK.brightBlack, DARK.background) >= 2.6,
    `dark brightBlack (${DARK.brightBlack}) dim tone is too faint`,
  );
});
