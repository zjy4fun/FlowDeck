import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
const panesSource = readFileSync(new URL('../src/renderer/panes.ts', import.meta.url), 'utf8');
const lifecycleSource = readFileSync(
  new URL('../src/renderer/controllers/lifecycle.ts', import.meta.url),
  'utf8',
);

test('panes animate their width so the layout reflows smoothly on create/close', () => {
  const paneRule = styles.match(/\n\.pane \{(?<body>[^}]+)\}/);
  assert.ok(paneRule, 'expected a .pane CSS rule');
  assert.match(paneRule.groups.body, /transition:[^;]*\btransform\b/s);
  assert.match(paneRule.groups.body, /transition:[^;]*\bwidth\b/s);
});

test('pane enter and leave keyframes exist', () => {
  assert.match(styles, /@keyframes pane-enter \{/);
  assert.match(styles, /@keyframes pane-leave \{/);
  assert.match(styles, /\.pane\.is-entering \.pane-shell \{[^}]*animation:\s*pane-enter/s);
  assert.match(styles, /\.pane\.is-closing \.pane-shell \{[^}]*animation:\s*pane-leave/s);
});

test('layout transition is suppressed while dragging a divider or resizing the window', () => {
  assert.match(
    styles,
    /body\.is-resizing-pane \.pane,\s*body\.is-window-resizing \.pane \{[^}]*transition:\s*box-shadow/s,
  );
});

test('a new pane holds position instead of sliding in from the left edge', () => {
  assert.match(styles, /\.pane\.is-entering \{[^}]*transition:\s*box-shadow/s);
  assert.match(panesSource, /classList\.add\('is-entering'\)/);
});

test('closing a pane fades it out before tearing it down', () => {
  // Removal must be deferred behind the leave animation, not synchronous.
  assert.match(panesSource, /classList\.add\('is-closing'\)/);
  assert.match(panesSource, /addEventListener\('animationend'/);
  assert.match(panesSource, /function finalizePaneRemoval/);
  // The terminal teardown happens inside the deferred finalizer.
  const finalizer = panesSource.match(/function finalizePaneRemoval[^]*?\n\}/);
  assert.ok(finalizer, 'expected a finalizePaneRemoval function');
  assert.match(finalizer[0], /destroyTerminal/);
  assert.match(finalizer[0], /terminal\.dispose\(\)/);
  assert.match(finalizer[0], /root\.remove\(\)/);
});

test('pane animations respect prefers-reduced-motion', () => {
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(panesSource, /prefersReducedMotion/);
  // Enter is skipped and close is immediate when reduced motion is requested.
  assert.match(
    panesSource,
    /function closePaneNode[^]*?if \(prefersReducedMotion\(\)\) \{\s*finalizePaneRemoval/,
  );
});

test('window resize toggles the instant-layout class', () => {
  assert.match(lifecycleSource, /classList\.add\('is-window-resizing'\)/);
  assert.match(lifecycleSource, /classList\.remove\('is-window-resizing'\)/);
});
