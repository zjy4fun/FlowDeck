export interface ResolveTerminalFocusRecoveryOptions {
  previousFocusedPaneId: string | null;
  nextPaneId: string;
  activeElementClassName?: string | null;
  targetTextareaIsActive: boolean;
  forceBlur?: boolean;
  refit?: boolean;
}

export interface TerminalFocusRecoveryStrategy {
  refit: boolean;
  forceBlur: boolean;
}

export function resolveTerminalFocusRecovery(
  options: ResolveTerminalFocusRecoveryOptions,
): TerminalFocusRecoveryStrategy {
  const switchingPanes = options.previousFocusedPaneId !== options.nextPaneId;
  const hasAnotherTerminalTextareaFocused =
    options.activeElementClassName === 'xterm-helper-textarea' &&
    !options.targetTextareaIsActive;

  return {
    refit: options.refit ?? switchingPanes,
    forceBlur: Boolean(options.forceBlur || hasAnotherTerminalTextareaFocused),
  };
}
