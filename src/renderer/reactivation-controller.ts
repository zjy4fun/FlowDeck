interface ReactivationControllerOptions {
  debounceMs: number;
  now?: () => number;
  onRefocusTerminal: () => void;
}

export interface ReactivationController {
  handleWindowReactivated: () => void;
  dispose: () => void;
}

export function createReactivationController(
  options: ReactivationControllerOptions,
): ReactivationController {
  const now = options.now ?? (() => Date.now());

  let lastWindowReactivateAt = 0;

  return {
    handleWindowReactivated(): void {
      const nowValue = now();
      if (nowValue - lastWindowReactivateAt < options.debounceMs) return;
      lastWindowReactivateAt = nowValue;
      options.onRefocusTerminal();
    },

    dispose(): void {},
  };
}
