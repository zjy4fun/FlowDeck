import {
  state,
  dom,
  initDom,
  paneNodeMap,
  getFocusedIndex,
  getDirectoryLabel,
  getDisplayPath,
} from './state';
import { bridge } from './bridge';
import { renderTabs, initTabs, clearPendingTabFocus, endTabDrag } from './tabs';
import { renderPanes, initPanes } from './panes';
import {
  applySettingsToDom,
  loadPersistedSettings,
  initSettingsListeners,
} from './settings';
import { createPaneActionsController } from './controllers/pane-actions';
import { createNavigationController } from './controllers/navigation';
import { initLifecycle } from './controllers/lifecycle';
import type { RenderFn, UsageProvider, UsageQuotaSnapshot } from './types';

/* ── Status bar ── */

const USAGE_REFRESH_INTERVAL_MS = 10_000;
const USAGE_EVENT_THROTTLE_MS = 4_000;
let usageQuota: UsageQuotaSnapshot | null = null;
let isRefreshingUsageQuota = false;
let usageRefreshQueued = false;
let usageRefreshTimer: number | null = null;
let lastUsageRefreshStartedAt = 0;

function createEmptyUsageQuota(provider: UsageProvider): UsageQuotaSnapshot {
  return {
    provider,
    sessionUsedPercent: null,
    sessionResetsAt: null,
    weeklyUsedPercent: null,
    weeklyResetsAt: null,
    sessionInputTokens: null,
    sessionOutputTokens: null,
    sessionTotalTokens: null,
    queriedAt: new Date().toISOString(),
  };
}

function hasUsageQuotaData(quota: UsageQuotaSnapshot | null): boolean {
  if (!quota) return false;
  return (
    quota.sessionUsedPercent !== null ||
    quota.sessionResetsAt !== null ||
    quota.weeklyUsedPercent !== null ||
    quota.weeklyResetsAt !== null ||
    quota.sessionTotalTokens !== null
  );
}

function formatPercentLeft(usedPercent: number | null): string {
  if (usedPercent === null) return '-- left';
  const remaining = Math.floor(Math.max(0, Math.min(100, 100 - usedPercent)));
  return `${remaining}% left`;
}

function formatCheckedTime(checkedAt: string | null): string {
  if (!checkedAt) return '--';
  const timestamp = new Date(checkedAt);
  if (Number.isNaN(timestamp.getTime())) return checkedAt;
  return timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatResetsIn(resetsAt: number | null): string {
  if (resetsAt === null) return '--';
  const remainingMs = Math.max(0, (resetsAt * 1000) - Date.now());
  const remainingSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(remainingSeconds / 86400);
  const hours = Math.floor((remainingSeconds % 86400) / 3600);
  const minutes = Math.floor((remainingSeconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatTokenCount(value: number | null): string {
  if (value === null) return '--';
  return value.toLocaleString();
}

function compactPathLabel(displayPath: string, maxLength = 52): string {
  if (displayPath.length <= maxLength) return displayPath;
  if (displayPath === '~') return displayPath;

  let prefix = '';
  let remainder = displayPath;

  if (displayPath.startsWith('~/')) {
    prefix = '~/';
    remainder = displayPath.slice(2);
  } else if (displayPath.startsWith('/')) {
    prefix = '/';
    remainder = displayPath.slice(1);
  }

  const parts = remainder.split('/').filter(Boolean);
  if (parts.length >= 2) {
    const lastTwo = `${prefix}.../${parts.slice(-2).join('/')}`;
    if (lastTwo.length <= maxLength) return lastTwo;

    const lastOne = `${prefix}.../${parts[parts.length - 1]}`;
    if (lastOne.length <= maxLength) return lastOne;
  }

  return `...${displayPath.slice(-(maxLength - 3))}`;
}

function getProviderLabel(provider: UsageProvider): string {
  return provider === 'claude-code' ? 'Claude Code' : 'CodeX';
}

function getPrimaryWindowLabel(provider: UsageProvider): string {
  return provider === 'claude-code' ? '5h' : 'Session';
}

function getSecondaryWindowLabel(provider: UsageProvider): string {
  return provider === 'claude-code' ? '7d' : 'Weekly';
}

function getUsageStatusHint(): string {
  const selectedProvider = state.settings.usageProvider;
  const provider: UsageProvider =
    selectedProvider === 'codex' && usageQuota?.provider === 'claude-code'
      ? 'claude-code'
      : selectedProvider;
  const shouldUseSnapshot = usageQuota?.provider === provider;
  const sessionUsedPercent = shouldUseSnapshot
    ? usageQuota?.sessionUsedPercent ?? null
    : null;
  const sessionResetsAt = shouldUseSnapshot ? usageQuota?.sessionResetsAt ?? null : null;
  const weeklyUsedPercent = shouldUseSnapshot ? usageQuota?.weeklyUsedPercent ?? null : null;
  const weeklyResetsAt = shouldUseSnapshot ? usageQuota?.weeklyResetsAt ?? null : null;
  const sessionInputTokens = shouldUseSnapshot
    ? usageQuota?.sessionInputTokens ?? null
    : null;
  const sessionOutputTokens = shouldUseSnapshot
    ? usageQuota?.sessionOutputTokens ?? null
    : null;
  const sessionTotalTokens = shouldUseSnapshot
    ? usageQuota?.sessionTotalTokens ?? null
    : null;
  const checkedAt = shouldUseSnapshot ? usageQuota?.queriedAt ?? null : null;
  const hasRateLimitData =
    sessionUsedPercent !== null ||
    sessionResetsAt !== null ||
    weeklyUsedPercent !== null ||
    weeklyResetsAt !== null;

  if (provider === 'claude-code' && !hasRateLimitData && sessionTotalTokens !== null) {
    return `${getProviderLabel(provider)} | Session tokens ${formatTokenCount(sessionTotalTokens)} (in ${formatTokenCount(sessionInputTokens)}, out ${formatTokenCount(sessionOutputTokens)}) | 5h/7d limits unavailable | Checked ${formatCheckedTime(checkedAt)}`;
  }

  return `${getProviderLabel(provider)} | ${getPrimaryWindowLabel(provider)} ${formatPercentLeft(sessionUsedPercent)}, Resets in ${formatResetsIn(sessionResetsAt)} | ${getSecondaryWindowLabel(provider)} ${formatPercentLeft(weeklyUsedPercent)}, Resets in ${formatResetsIn(weeklyResetsAt)} | Checked ${formatCheckedTime(checkedAt)}`;
}

function clearUsageRefreshTimer(): void {
  if (usageRefreshTimer !== null) {
    window.clearTimeout(usageRefreshTimer);
    usageRefreshTimer = null;
  }
}

function requestUsageQuotaRefresh(force = false): void {
  if (isRefreshingUsageQuota) {
    usageRefreshQueued = true;
    return;
  }

  const elapsedMs = Date.now() - lastUsageRefreshStartedAt;
  const throttleWaitMs = force
    ? 0
    : Math.max(0, USAGE_EVENT_THROTTLE_MS - elapsedMs);

  if (throttleWaitMs === 0) {
    void refreshUsageQuota();
    return;
  }

  clearUsageRefreshTimer();
  usageRefreshTimer = window.setTimeout(() => {
    usageRefreshTimer = null;
    void refreshUsageQuota();
  }, throttleWaitMs);
}

async function tryLoadUsageQuota(
  provider: UsageProvider,
): Promise<UsageQuotaSnapshot | null> {
  try {
    return await bridge.loadUsageQuota(provider);
  } catch (error) {
    console.error(`Failed to load ${provider} usage quota:`, error);
    return null;
  }
}

async function refreshUsageQuota(): Promise<void> {
  if (isRefreshingUsageQuota) return;
  clearUsageRefreshTimer();
  isRefreshingUsageQuota = true;
  usageRefreshQueued = false;
  lastUsageRefreshStartedAt = Date.now();

  const provider = state.settings.usageProvider;
  try {
    let nextQuota = await tryLoadUsageQuota(provider);

    // Default behavior: prefer CodeX, but automatically fall back to Claude Code
    // if CodeX has no usable quota snapshot.
    if (provider === 'codex' && !hasUsageQuotaData(nextQuota)) {
      const fallbackQuota = await tryLoadUsageQuota('claude-code');
      if (hasUsageQuotaData(fallbackQuota)) {
        nextQuota = fallbackQuota;
      }
    }

    if (state.settings.usageProvider !== provider) {
      usageRefreshQueued = true;
      return;
    }

    usageQuota = nextQuota ?? createEmptyUsageQuota(provider);
  } finally {
    isRefreshingUsageQuota = false;
    updateStatus();
    if (usageRefreshQueued) {
      usageRefreshQueued = false;
      requestUsageQuotaRefresh(true);
    }
  }
}

function updateStatus(): void {
  const focusedIndex = getFocusedIndex();
  const focusedPane = focusedIndex === -1 ? null : state.panes[focusedIndex];
  const usageHint = getUsageStatusHint();

  if (state.isNavigationMode) {
    dom.statusLabel.classList.add('is-navigation-mode');
    dom.statusLabel.title = '';
    dom.statusLabel.textContent = 'Navigation Mode';
    dom.statusHint.textContent = usageHint;
    return;
  }

  dom.statusLabel.classList.remove('is-navigation-mode');
  if (!focusedPane) {
    dom.statusLabel.title = '';
    dom.statusLabel.textContent = 'No Session';
    dom.statusHint.textContent = usageHint;
    return;
  }

  const fullDisplayPath = getDisplayPath(focusedPane.cwd);
  dom.statusLabel.title = fullDisplayPath;
  dom.statusLabel.textContent = compactPathLabel(fullDisplayPath);
  dom.statusHint.textContent = usageHint;
}

function createRenderGateway(): RenderFn {
  return (refit = false): void => {
    renderTabs();
    renderPanes(refit);
    updateStatus();
  };
}

function reportError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  dom.statusLabel.title = message;
  dom.statusLabel.textContent = `Error: ${message}`;
  dom.statusHint.textContent = getUsageStatusHint();
  console.error(error);
}

function focusActivePaneTerminal(): void {
  if (state.isNavigationMode || !state.focusedPaneId) return;

  const activeElement = document.activeElement as HTMLElement | null;
  if (
    activeElement &&
    (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.tagName === 'SELECT' ||
      activeElement.isContentEditable
    )
  ) {
    return;
  }

  const node = paneNodeMap.get(state.focusedPaneId);
  if (!node) return;

  requestAnimationFrame(() => {
    if (!state.isNavigationMode) node.terminal.focus();
  });
}

/* ── Bootstrap ── */

export async function startApp(): Promise<void> {
  initDom();

  const render = createRenderGateway();

  const paneActions = createPaneActionsController({
    render,
    renderTabs,
    clearPendingTabFocus,
    endTabDrag,
  });

  const triggerProviderRefresh = (force = false): void => {
    usageQuota = createEmptyUsageQuota(state.settings.usageProvider);
    updateStatus();
    requestUsageQuotaRefresh(force);
  };

  const addPane = (cwdOverride?: string): void => {
    paneActions.addPane(cwdOverride);
    requestUsageQuotaRefresh(true);
  };

  const closePane = async (index: number): Promise<void> => {
    const beforeCount = state.panes.length;
    await paneActions.closePane(index);
    if (state.panes.length > 0 && state.panes.length !== beforeCount) {
      requestUsageQuotaRefresh(true);
    }
  };

  const addPaneFromSelectedDirectory = async (): Promise<void> => {
    const beforeCount = state.panes.length;
    try {
      await paneActions.addPaneFromSelectedDirectory();
      if (state.panes.length > 0 && state.panes.length !== beforeCount) {
        requestUsageQuotaRefresh(true);
      }
    } catch (error) {
      reportError(error);
    }
  };

  const navigation = createNavigationController({
    addPane,
    closePane,
    focusPane: paneActions.focusPane,
    render,
  });

  initTabs({
    focusPane: paneActions.focusPane,
    closePane,
    addPaneFromSelectedDirectory,
    render: () => render(),
  });

  initPanes({
    onPaneClick: paneActions.focusPane,
    onTitleChange: paneActions.handleTitleChange,
  });

  // Load persisted settings, then apply to DOM
  await loadPersistedSettings();
  state.panes = state.panes.slice(0, state.settings.maxSessions).map((pane) => ({
    ...pane,
    cwd: state.settings.defaultOpenDirectory,
    terminalTitle: getDirectoryLabel(state.settings.defaultOpenDirectory),
  }));
  state.focusedPaneId = state.panes[0]?.id ?? null;
  state.nextPaneNumber = state.panes.length + 1;
  applySettingsToDom();

  initSettingsListeners(
    (refit) => render(refit),
    () => {
      triggerProviderRefresh(true);
    },
  );

  initLifecycle({
    addPane,
    closePane,
    handleCwdChange: paneActions.handleCwdChange,
    handleGlobalKeydown: navigation.handleGlobalKeydown,
    reloadSettings: loadPersistedSettings,
    render,
    reportError,
    onSettingsReloaded: () => {
      triggerProviderRefresh(true);
    },
    onSessionExit: () => {
      requestUsageQuotaRefresh(true);
    },
  });

  const refreshTimer = window.setInterval(() => {
    requestUsageQuotaRefresh();
  }, USAGE_REFRESH_INTERVAL_MS);
  const handleWindowFocus = (): void => {
    requestUsageQuotaRefresh(true);
    focusActivePaneTerminal();
  };
  window.addEventListener('focus', handleWindowFocus);
  const handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      requestUsageQuotaRefresh(true);
      focusActivePaneTerminal();
    }
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('beforeunload', () => {
    window.clearInterval(refreshTimer);
    clearUsageRefreshTimer();
    window.removeEventListener('focus', handleWindowFocus);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, { once: true });

  requestUsageQuotaRefresh(true);
  render(true);
}
