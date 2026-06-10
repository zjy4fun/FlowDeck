type TimerHandle = ReturnType<typeof setTimeout>;

interface PaneBatchState {
  chunks: string[];
  pendingBytes: number;
  timer: TimerHandle | null;
}

interface TerminalDataBatcherOptions {
  flushDelayMs?: number;
  maxBatchBytes?: number;
  send: (paneId: string, data: string) => void;
  schedule?: (callback: () => void, delay: number) => TimerHandle;
  cancel?: (handle: TimerHandle) => void;
  now?: () => number;
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
  const maxBatchBytes = options.maxBatchBytes ?? 256 * 1024;
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const cancel = options.cancel ?? ((handle) => clearTimeout(handle));
  const now = options.now ?? (() => Date.now());
  const batches = new Map<string, PaneBatchState>();
  const lastFlushAt = new Map<string, number>();

  const ensureBatch = (paneId: string): PaneBatchState => {
    let batch = batches.get(paneId);
    if (!batch) {
      batch = { chunks: [], pendingBytes: 0, timer: null };
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
    batch.pendingBytes = 0;
    batches.delete(paneId);
    lastFlushAt.set(paneId, now());
    options.send(paneId, data);
  };

  return {
    queue(paneId: string, data: string): void {
      if (!data) return;
      const batch = ensureBatch(paneId);
      batch.chunks.push(data);
      batch.pendingBytes += Buffer.byteLength(data);
      if (batch.pendingBytes >= maxBatchBytes) {
        flushPane(paneId);
        return;
      }
      if (batch.timer !== null) return;
      const previousFlushAt = lastFlushAt.get(paneId);
      const elapsed = previousFlushAt === undefined
        ? Number.POSITIVE_INFINITY
        : now() - previousFlushAt;
      if (elapsed >= flushDelayMs) {
        flushPane(paneId);
        return;
      }
      batch.timer = schedule(() => {
        const pendingBatch = batches.get(paneId);
        if (pendingBatch) {
          pendingBatch.timer = null;
        }
        flushPane(paneId);
      }, Math.max(0, flushDelayMs - elapsed));
    },

    flushPane,

    deletePane(paneId: string): void {
      const batch = batches.get(paneId);
      if (!batch) return;
      if (batch.timer !== null) {
        cancel(batch.timer);
      }
      batches.delete(paneId);
      lastFlushAt.delete(paneId);
    },

    flushAll(): void {
      for (const paneId of Array.from(batches.keys())) {
        flushPane(paneId);
      }
    },
  };
}
