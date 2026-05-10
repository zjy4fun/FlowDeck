export type TerminalContextMenuAction = 'paste';

export interface TerminalContextMenuRequest {
  paneId: string;
  selectedText: string;
}

export function sanitizeTerminalContextMenuRequest(
  payload: unknown,
): TerminalContextMenuRequest | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const source = payload as Record<string, unknown>;
  if (typeof source.paneId !== 'string' || source.paneId.trim().length === 0) {
    return null;
  }

  return {
    paneId: source.paneId,
    selectedText: typeof source.selectedText === 'string' ? source.selectedText : '',
  };
}

export function createTranslateUrl(selectedText: string): string {
  const params = new URLSearchParams({
    sl: 'auto',
    tl: 'zh-CN',
    text: selectedText,
    op: 'translate',
  });
  return `https://translate.google.com/?${params.toString()}`;
}

export function createSearchUrl(selectedText: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(selectedText)}`;
}
