type TimeoutHandle = ReturnType<typeof globalThis.setTimeout> | number;

interface ReactivationControllerOptions {
  debounceMs: number;
  usageRefreshDelayMs: number;
  now?: () => number;
  onRefocusTerminal: () => void;
  onRefreshUsage: () => void;
  scheduleTimeout?: (callback: () => void, delay: number) => TimeoutHandle;
  clearScheduledTimeout?: (handle: TimeoutHandle) => void;
}

export interface ReactivationController {
  handleWindowReactivated: () => void;
  dispose: () => void;
}

export function createReactivationController(
  options: ReactivationControllerOptions,
): ReactivationController {
  const now = options.now ?? (() => Date.now());
  const scheduleTimeout =
    options.scheduleTimeout ?? ((callback, delay) => window.setTimeout(callback, delay));
  const clearScheduledTimeout =
    options.clearScheduledTimeout ?? ((handle) => window.clearTimeout(handle));

  let lastWindowReactivateAt = 0;
  let pendingUsageRefreshTimer: TimeoutHandle | null = null;

  const scheduleUsageRefresh = (): void => {
    if (pendingUsageRefreshTimer !== null) {
      clearScheduledTimeout(pendingUsageRefreshTimer);
    }
    pendingUsageRefreshTimer = scheduleTimeout(() => {
      pendingUsageRefreshTimer = null;
      options.onRefreshUsage();
    }, options.usageRefreshDelayMs);
  };

  return {
    handleWindowReactivated(): void {
      const nowValue = now();
      if (nowValue - lastWindowReactivateAt < options.debounceMs) return;
      lastWindowReactivateAt = nowValue;
      options.onRefocusTerminal();
      scheduleUsageRefresh();
    },

    dispose(): void {
      if (pendingUsageRefreshTimer !== null) {
        clearScheduledTimeout(pendingUsageRefreshTimer);
        pendingUsageRefreshTimer = null;
      }
    },
  };
}
