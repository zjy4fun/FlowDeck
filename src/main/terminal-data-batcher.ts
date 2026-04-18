type TimerHandle = ReturnType<typeof setTimeout>;

interface PaneBatchState {
  chunks: string[];
  timer: TimerHandle | null;
}

interface TerminalDataBatcherOptions {
  flushDelayMs?: number;
  send: (paneId: string, data: string) => void;
  schedule?: (callback: () => void, delay: number) => TimerHandle;
  cancel?: (handle: TimerHandle) => void;
}

export interface TerminalDataBatcher {
  queue: (paneId: string, data: string) => void;
  flushPane: (paneId: string) => void;
  deletePane: (paneId: string) => void;
  flushAll: () => void;
}

export function createTerminalDataBatcher(
  options: TerminalDataBatcherOptions,
): TerminalDataBatcher {
  const flushDelayMs = options.flushDelayMs ?? 16;
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle));
  const batches = new Map<string, PaneBatchState>();

  const ensureBatch = (paneId: string): PaneBatchState => {
    let batch = batches.get(paneId);
    if (!batch) {
      batch = { chunks: [], timer: null };
      batches.set(paneId, batch);
    }
    return batch;
  };

  const flushPane = (paneId: string): void => {
    const batch = batches.get(paneId);
    if (!batch) return;

    if (batch.timer !== null) {
      cancel(batch.timer);
      batch.timer = null;
    }

    if (batch.chunks.length === 0) {
      batches.delete(paneId);
      return;
    }

    const data = batch.chunks.join('');
    batch.chunks = [];
    batches.delete(paneId);
    options.send(paneId, data);
  };

  return {
    queue(paneId: string, data: string): void {
      if (!data) return;
      const batch = ensureBatch(paneId);
      batch.chunks.push(data);
      if (batch.timer !== null) return;
      batch.timer = schedule(() => {
        const pendingBatch = batches.get(paneId);
        if (pendingBatch) {
          pendingBatch.timer = null;
        }
        flushPane(paneId);
      }, flushDelayMs);
    },

    flushPane,

    deletePane(paneId: string): void {
      const batch = batches.get(paneId);
      if (!batch) return;
      if (batch.timer !== null) {
        cancel(batch.timer);
      }
      batches.delete(paneId);
    },

    flushAll(): void {
      for (const paneId of Array.from(batches.keys())) {
        flushPane(paneId);
      }
    },
  };
}
