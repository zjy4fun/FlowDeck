import { bridge } from './bridge';
import { paneNodeMap, state } from './state';
import type { PaneData, PaneNode } from './types';

interface PaneAiState {
  prompt: string;
  command: string;
  loading: boolean;
  error: string | null;
  requestId: number;
}

const paneAiState = new Map<string, PaneAiState>();
let nextRequestId = 1;

function getPaneState(paneId: string): PaneAiState {
  let aiState = paneAiState.get(paneId);
  if (!aiState) {
    aiState = {
      prompt: '',
      command: '',
      loading: false,
      error: null,
      requestId: 0,
    };
    paneAiState.set(paneId, aiState);
  }
  return aiState;
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

function getAiStatus(aiState: PaneAiState): { text: string; title: string } {
  const command = aiState.command.trim();
  const text = aiState.loading
    ? 'Codex generating…'
    : aiState.error
      ? aiState.error
      : command
        ? 'Ready to run'
        : 'Describe a shell command';
  return { text: command || text, title: command || text };
}

function setResultContent(result: HTMLElement, text: string, title: string): void {
  result.textContent = text;
  result.title = title;
  result.dataset.fullCommand = title;
}

function updateAiToolbarControls(node: PaneNode, aiState: PaneAiState): void {
  const command = aiState.command.trim();
  const generateButton = node.aiToolbar.querySelector<HTMLButtonElement>('.aibar-generate');
  const runButton = node.aiToolbar.querySelector<HTMLButtonElement>('.aibar-run');
  const result = node.aiToolbar.querySelector<HTMLElement>('.aibar-result');
  const status = getAiStatus(aiState);

  if (generateButton) {
    generateButton.disabled = aiState.prompt.trim().length === 0 || aiState.loading;
    generateButton.textContent = aiState.loading ? 'Generating' : 'Generate';
  }
  if (runButton) {
    runButton.disabled = !command || aiState.loading;
  }
  if (result) {
    setResultContent(result, status.text, status.title);
  }
}

function getErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Failed to generate command';
  return err.message.replace(/^Error invoking remote method '[^']+':\s*/i, '').trim() || err.message;
}

function pasteToPane(paneId: string, command: string): void {
  const node = paneNodeMap.get(paneId);
  if (!node?.sessionReady) return;
  bridge.writeTerminal({ paneId, data: command }).catch((err) => {
    console.error('Failed to paste AI command:', err);
  });
  node.terminal.focus();
}

function writeToPane(paneId: string, data: string): void {
  const node = paneNodeMap.get(paneId);
  if (!node?.sessionReady) return;
  bridge.writeTerminal({ paneId, data }).catch((err) => {
    console.error('Failed to write AI command:', err);
  });
}

function renderAiToolbar(node: PaneNode, pane: PaneData): void {
  const aiState = getPaneState(pane.id);
  const canGenerate = aiState.prompt.trim().length > 0 && !aiState.loading;
  const command = aiState.command.trim();
  const status = getAiStatus(aiState);

  node.aiToolbar.innerHTML = `
    <div class="aibar-badge">AI</div>
    <input class="aibar-input" data-ai-action="prompt" value="${escapeHtml(aiState.prompt)}" placeholder="Describe what you want to do in this session…" spellcheck="false" />
    <button class="aibar-generate" data-ai-action="generate" type="button" ${canGenerate ? '' : 'disabled'}>${aiState.loading ? 'Generating' : 'Generate'}</button>
    <button class="aibar-run" data-ai-action="run" type="button" ${command && !aiState.loading ? '' : 'disabled'}>Run</button>
    <div class="aibar-result" data-ai-action="paste" data-full-command="${escapeHtml(status.title)}" title="${escapeHtml(status.title)}">${escapeHtml(status.text)}</div>
  `;
}

export function renderAiToolbarForPane(paneId: string): void {
  const pane = state.panes.find((item) => item.id === paneId);
  const node = paneNodeMap.get(paneId);
  if (!pane || !node) return;
  node.root.classList.toggle('has-aibar', state.settings.aiModeEnabled);
  if (!state.settings.aiModeEnabled) return;
  renderAiToolbar(node, pane);
}

export function refreshAllAiToolbars(): void {
  for (const pane of state.panes) {
    renderAiToolbarForPane(pane.id);
  }
}

export function removeAiState(paneId: string): void {
  paneAiState.delete(paneId);
}

async function generateCommand(paneId: string): Promise<void> {
  const pane = state.panes.find((item) => item.id === paneId);
  const node = paneNodeMap.get(paneId);
  if (!pane || !node) return;

  const aiState = getPaneState(paneId);
  const description = aiState.prompt.trim();
  if (!description || aiState.loading) return;

  const requestId = nextRequestId++;
  aiState.requestId = requestId;
  aiState.loading = true;
  aiState.error = null;
  aiState.command = '';
  updateAiToolbarControls(node, aiState);

  try {
    const result = await bridge.generateAiCommand({ cwd: pane.cwd, description });
    if (aiState.requestId !== requestId) return;
    aiState.command = result.command;
  } catch (err) {
    if (aiState.requestId !== requestId) return;
    aiState.error = getErrorMessage(err);
  } finally {
    if (aiState.requestId !== requestId) return;
    aiState.loading = false;
    updateAiToolbarControls(node, aiState);
  }
}

export function handleAiToolbarEvent(event: Event): void {
  const target = event.target as HTMLElement | null;
  const actionTarget = target?.closest<HTMLElement>('[data-ai-action]');
  if (!actionTarget) return;

  const toolbar = actionTarget.closest<HTMLElement>('.ai-toolbar');
  const paneId = toolbar?.dataset.paneId;
  if (!paneId) return;

  const aiState = getPaneState(paneId);
  const action = actionTarget.dataset.aiAction;

  if (action === 'prompt' && actionTarget instanceof HTMLInputElement) {
    event.stopPropagation();

    if (event.type === 'keydown') {
      if ((event as KeyboardEvent).key === 'Enter' && !(event as KeyboardEvent).isComposing) {
        event.preventDefault();
        void generateCommand(paneId);
      }
      return;
    }

    if (event.type === 'input') {
      aiState.prompt = actionTarget.value;
      aiState.command = '';
      aiState.error = null;
      const node = paneNodeMap.get(paneId);
      if (node) updateAiToolbarControls(node, aiState);
    }
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if (action === 'generate') {
    void generateCommand(paneId);
  } else if (action === 'run') {
    const command = aiState.command.trim();
    if (command) writeToPane(paneId, shellRunData(command));
  } else if (action === 'paste') {
    const command = aiState.command.trim();
    if (command) pasteToPane(paneId, command);
  }
}
