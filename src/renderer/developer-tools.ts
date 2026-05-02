import { bridge } from './bridge';
import { getDisplayPath, paneNodeMap, state } from './state';
import type { DeveloperContext, PaneData, PaneNode } from './types';

interface PaneDeveloperState {
  cwd: string;
  context: DeveloperContext | null;
  selectedCommand: string;
  runningCommand: string | null;
  loading: boolean;
  requestId: number;
}

const paneDeveloperState = new Map<string, PaneDeveloperState>();
let nextRequestId = 1;

function getPaneState(pane: PaneData): PaneDeveloperState {
  let devState = paneDeveloperState.get(pane.id);
  if (!devState) {
    devState = {
      cwd: pane.cwd,
      context: null,
      selectedCommand: '',
      runningCommand: null,
      loading: false,
      requestId: 0,
    };
    paneDeveloperState.set(pane.id, devState);
  }
  return devState;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return char;
    }
  });
}

function shellRunData(command: string): string {
  return `\x03${command}\r`;
}

function getSelectedCommand(devState: PaneDeveloperState): string {
  const scripts = devState.context?.scripts ?? [];
  if (scripts.some((script) => script.command === devState.selectedCommand)) {
    return devState.selectedCommand;
  }
  return scripts[0]?.command ?? '';
}

function writeToPane(paneId: string, data: string): void {
  const node = paneNodeMap.get(paneId);
  if (!node?.sessionReady) return;
  bridge.writeTerminal({ paneId, data }).catch((err) => {
    console.error('Failed to write developer command:', err);
  });
}

function runPaneScript(paneId: string, command: string): void {
  if (!command) return;
  const pane = state.panes.find((item) => item.id === paneId);
  const devState = pane ? getPaneState(pane) : paneDeveloperState.get(paneId);
  if (devState) devState.runningCommand = command;
  writeToPane(paneId, shellRunData(command));
  renderDeveloperToolbarForPane(paneId);
}

function stopPaneScript(paneId: string): void {
  const devState = paneDeveloperState.get(paneId);
  if (devState) devState.runningCommand = null;
  writeToPane(paneId, '\x03');
  renderDeveloperToolbarForPane(paneId);
}

function restartPaneScript(paneId: string): void {
  const devState = paneDeveloperState.get(paneId);
  const command = devState ? (devState.runningCommand ?? getSelectedCommand(devState)) : '';
  if (command) runPaneScript(paneId, command);
}

function renderDeveloperToolbar(node: PaneNode, pane: PaneData): void {
  const devState = getPaneState(pane);
  const context = devState.context;
  const scripts = context?.scripts ?? [];
  const selectedCommand = getSelectedCommand(devState);
  const running = Boolean(devState.runningCommand);
  const repoChip = context?.git?.chip ?? 'not a git repo';
  const repoTitle = context?.git?.tooltip ?? repoChip;
  const projectType = context?.projectType ?? (devState.loading ? 'Detecting…' : 'Shell');
  const projectRoot = context?.projectRoot ?? pane.cwd;
  const projectLabel = getDisplayPath(projectRoot);
  const hasScripts = scripts.length > 0;

  node.developerToolbar.innerHTML = `
    <div class="devbar-meta" title="${escapeHtml(projectLabel)}">
      <span class="devbar-type">${escapeHtml(projectType)}</span>
      <span class="devbar-path">${escapeHtml(projectLabel)}</span>
    </div>
    <select class="devbar-select" data-dev-action="select" ${hasScripts ? '' : 'disabled'} aria-label="Select script">
      ${hasScripts
        ? scripts.map((script) => `<option value="${escapeHtml(script.command)}" ${script.command === selectedCommand ? 'selected' : ''}>${escapeHtml(script.label)}</option>`).join('')
        : '<option>No scripts detected</option>'}
    </select>
    <div class="devbar-actions">
      <button class="devbar-run" data-dev-action="run" ${hasScripts ? '' : 'disabled'} type="button">${running ? 'Running' : 'Run'}</button>
      <button class="devbar-stop" data-dev-action="stop" type="button" ${running ? '' : 'disabled'}>Stop</button>
      <button class="devbar-restart" data-dev-action="restart" type="button" ${hasScripts ? '' : 'disabled'}>Restart</button>
      <span class="devbar-repo" title="${escapeHtml(repoTitle)}">${escapeHtml(repoChip)}</span>
    </div>
  `;
}

export function renderDeveloperToolbarForPane(paneId: string): void {
  const pane = state.panes.find((item) => item.id === paneId);
  const node = paneNodeMap.get(paneId);
  if (!pane || !node) return;
  node.root.classList.toggle('has-devbar', state.settings.developerModeEnabled);
  if (!state.settings.developerModeEnabled) return;
  renderDeveloperToolbar(node, pane);
}

export function refreshDeveloperContextForPane(pane: PaneData): void {
  const node = paneNodeMap.get(pane.id);
  if (!node) return;

  node.root.classList.toggle('has-devbar', state.settings.developerModeEnabled);
  if (!state.settings.developerModeEnabled) return;

  const devState = getPaneState(pane);
  if (devState.cwd === pane.cwd && (devState.context || devState.loading)) {
    renderDeveloperToolbar(node, pane);
    return;
  }

  devState.cwd = pane.cwd;
  devState.loading = true;
  devState.context = null;
  devState.selectedCommand = '';
  const requestId = nextRequestId++;
  devState.requestId = requestId;
  renderDeveloperToolbar(node, pane);

  bridge.getDeveloperContext({ cwd: pane.cwd })
    .then((context) => {
      if (devState.requestId !== requestId) return;
      devState.context = context;
      devState.selectedCommand = context.scripts[0]?.command ?? '';
    })
    .catch((err) => {
      console.error('Failed to load developer context:', err);
    })
    .finally(() => {
      if (devState.requestId !== requestId) return;
      devState.loading = false;
      renderDeveloperToolbarForPane(pane.id);
    });
}

export function refreshAllDeveloperContexts(): void {
  for (const pane of state.panes) {
    const devState = paneDeveloperState.get(pane.id);
    if (devState) {
      devState.cwd = '';
    }
    refreshDeveloperContextForPane(pane);
  }
}

export function removeDeveloperState(paneId: string): void {
  paneDeveloperState.delete(paneId);
}

export function handleDeveloperToolbarEvent(event: Event): void {
  const target = event.target as HTMLElement | null;
  const actionTarget = target?.closest<HTMLElement>('[data-dev-action]');
  if (!actionTarget) return;

  const toolbar = actionTarget.closest<HTMLElement>('.developer-toolbar');
  const paneId = toolbar?.dataset.paneId;
  if (!paneId) return;

  const devState = paneDeveloperState.get(paneId);
  const action = actionTarget.dataset.devAction;

  if (action === 'select' && event.type !== 'change') {
    // Let the browser open the native select menu, but do not let the pane
    // click handler refocus/rerender the terminal underneath it.
    event.stopPropagation();
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if (action === 'select') {
    if (devState && actionTarget instanceof HTMLSelectElement) {
      devState.selectedCommand = actionTarget.value;
    }
    return;
  }

  if (action === 'run') {
    const command = devState ? getSelectedCommand(devState) : '';
    runPaneScript(paneId, command);
  } else if (action === 'stop') {
    stopPaneScript(paneId);
  } else if (action === 'restart') {
    restartPaneScript(paneId);
  }
}
