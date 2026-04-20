import { state, dom, getResolvedTheme, paneNodeMap } from './state';
import { bridge } from './bridge';
import { createTerminalTheme, getTerminalBackground } from './terminal';

/* ── Debounced persistence ── */

let saveTimer: number | null = null;

function getPaneToneOpacity(paneOpacity: number): number {
  // Keep non-focused panes readable while preserving visual hierarchy.
  const normalized = Math.max(0.5, Math.min(1, paneOpacity));
  return Number((0.12 + (1 - normalized) * 0.96).toFixed(2));
}

function persistSettings(): void {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    bridge.saveSettings({ ...state.settings }).catch((err) => {
      console.error('Failed to persist settings:', err);
    });
  }, 500);
}

/* ── Apply current settings to CSS variables and input elements ── */

export function applyThemeToDom(): void {
  const resolved = getResolvedTheme();
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);
  root.style.setProperty('--terminal-bg', getTerminalBackground(resolved));
  paneNodeMap.forEach((node) => {
    node.terminal.options.theme = createTerminalTheme(node.accent, resolved);
  });
}

export function applySettingsToDom(): void {
  const { settings } = state;
  const root = document.documentElement;
  const paneWidthPx = Math.round(dom.stage.clientWidth * settings.paneWidthRatio);
  const paneWidthPercent = Math.round(settings.paneWidthRatio * 100);

  applyThemeToDom();

  root.style.setProperty('--app-font-size', `${settings.fontSize}px`);
  root.style.setProperty('--pane-opacity', settings.paneOpacity.toFixed(2));
  root.style.setProperty(
    '--pane-tone-opacity',
    getPaneToneOpacity(settings.paneOpacity).toFixed(2),
  );
  root.style.setProperty('--pane-width', `${paneWidthPx}px`);

  dom.fontSizeInput.value = String(settings.fontSize);
  dom.defaultDirectoryInput.value = settings.defaultOpenDirectory;
  dom.maxSessionsInput.value = String(settings.maxSessions);
  dom.paneWidthRange.value = String(paneWidthPercent);
  dom.paneWidthInput.value = String(paneWidthPercent);
  dom.paneWidthValue.textContent = `${paneWidthPercent}%`;
  dom.paneOpacityRange.value = settings.paneOpacity.toFixed(2);
  dom.paneOpacityInput.value = settings.paneOpacity.toFixed(2);
  dom.paneOpacityValue.textContent = settings.paneOpacity.toFixed(2);
  dom.themeModeSelect.value = settings.themeMode;
}

/* ── Load persisted settings from main process ── */

export async function loadPersistedSettings(): Promise<void> {
  try {
    const saved = await bridge.loadSettings();
    if (saved) {
      state.settings = { ...state.settings, ...saved };
    }
  } catch {
    // Use defaults on failure
  }
  applySettingsToDom();
}

/* ── Setting updaters ── */

function updateFontSize(
  value: string,
  render: (refit: boolean) => void,
): void {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    applySettingsToDom();
    return;
  }
  state.settings.fontSize = Math.max(10, Math.min(24, Math.round(parsed)));
  applySettingsToDom();
  persistSettings();
  render(true);
}

function updateDefaultOpenDirectory(value: string): void {
  const next = value.trim() || bridge.defaultCwd;
  state.settings.defaultOpenDirectory = next;
  applySettingsToDom();
  persistSettings();
}

function updateMaxSessions(value: string): void {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    applySettingsToDom();
    return;
  }
  state.settings.maxSessions = Math.max(1, Math.min(9, Math.round(parsed)));
  applySettingsToDom();
  persistSettings();
}

function updatePaneWidthRatio(
  value: string,
  render: (refit: boolean) => void,
): void {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    applySettingsToDom();
    return;
  }
  state.settings.paneWidthRatio = Math.max(
    0.22,
    Math.min(0.72, Number((Math.round(parsed) / 100).toFixed(2))),
  );
  applySettingsToDom();
  persistSettings();
  render(true);
}

function updatePaneOpacity(value: string): void {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    applySettingsToDom();
    return;
  }
  state.settings.paneOpacity = Math.max(
    0.5,
    Math.min(1, Number(parsed.toFixed(2))),
  );
  applySettingsToDom();
  persistSettings();
}

function updateThemeMode(value: string): void {
  const next =
    value === 'light' || value === 'dark' || value === 'system'
      ? value
      : 'system';
  if (state.settings.themeMode === next) return;
  state.settings.themeMode = next;
  applySettingsToDom();
  persistSettings();
}

/* ── Wire up settings panel event listeners ── */

export function initSettingsListeners(
  render: (refit: boolean) => void,
): void {
  dom.fontSizeInput.addEventListener('change', () => {
    updateFontSize(dom.fontSizeInput.value, render);
  });

  dom.defaultDirectoryInput.addEventListener('change', () => {
    updateDefaultOpenDirectory(dom.defaultDirectoryInput.value);
  });

  dom.defaultDirectoryInput.addEventListener('input', () => {
    updateDefaultOpenDirectory(dom.defaultDirectoryInput.value);
  });

  dom.maxSessionsInput.addEventListener('change', () => {
    updateMaxSessions(dom.maxSessionsInput.value);
  });

  dom.paneWidthRange.addEventListener('input', () => {
    updatePaneWidthRatio(dom.paneWidthRange.value, render);
  });

  dom.paneWidthInput.addEventListener('change', () => {
    updatePaneWidthRatio(dom.paneWidthInput.value, render);
  });

  dom.paneOpacityRange.addEventListener('input', () => {
    updatePaneOpacity(dom.paneOpacityRange.value);
  });

  dom.paneOpacityInput.addEventListener('change', () => {
    updatePaneOpacity(dom.paneOpacityInput.value);
  });

  dom.themeModeSelect.addEventListener('change', () => {
    updateThemeMode(dom.themeModeSelect.value);
  });

  if (window.matchMedia) {
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const handleChange = (): void => {
      if (state.settings.themeMode === 'system') applyThemeToDom();
    };
    if (mql.addEventListener) mql.addEventListener('change', handleChange);
    else mql.addListener(handleChange);
  }

  // Toggle panel visibility
  dom.settingsButton.addEventListener('click', (e) => {
    e.stopPropagation();
    dom.settingsPanel.classList.toggle('is-hidden');
  });

  dom.settingsPanel.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // Close panel on outside click or Escape
  window.addEventListener('pointerdown', (e) => {
    if (
      !dom.settingsPanel.classList.contains('is-hidden') &&
      !dom.settingsPanel.contains(e.target as Node) &&
      !dom.settingsButton.contains(e.target as Node)
    ) {
      dom.settingsPanel.classList.add('is-hidden');
    }
  });

  window.addEventListener('keydown', (e) => {
    if (
      e.key === 'Escape' &&
      !dom.settingsPanel.classList.contains('is-hidden')
    ) {
      dom.settingsPanel.classList.add('is-hidden');
    }
  });
}
