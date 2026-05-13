const SLIDING_WINDOW_SIZE = 5;

export type ETATracker = {
  startedAtMs: number;
  bytesDone: number;
  bytesTotal: number;
  lastMarkMs: number;
  // Each entry: bytes processed and wall time spent on those bytes
  window: { bytes: number; durationMs: number }[];
};

export const createETATracker = (
  bytesTotal: number,
  nowMs?: number,
): ETATracker => {
  const now = nowMs ?? performance.now();
  return {
    startedAtMs: now,
    bytesDone: 0,
    bytesTotal,
    lastMarkMs: now,
    window: [],
  };
};

export const markFileDone = (
  t: ETATracker,
  fileSizeBytes: number,
  nowMs?: number,
): void => {
  const now = nowMs ?? performance.now();
  const durationMs = now - t.lastMarkMs;

  t.bytesDone += fileSizeBytes;
  t.lastMarkMs = now;

  t.window.push({ bytes: fileSizeBytes, durationMs });
  if (t.window.length > SLIDING_WINDOW_SIZE) {
    t.window.shift();
  }
};

export const elapsedMs = (t: ETATracker, nowMs?: number): number =>
  (nowMs ?? performance.now()) - t.startedAtMs;

export const estimateRemainingMs = (
  t: ETATracker,
  nowMs?: number,
): number | null => {
  if (t.bytesDone === 0 || t.window.length === 0) return null;

  let windowBytes = 0;
  let windowDurationMs = 0;
  for (const entry of t.window) {
    windowBytes += entry.bytes;
    windowDurationMs += entry.durationMs;
  }

  // If there is time elapsed since the last file-done mark, include it as an
  // implicit in-progress contribution to the duration — keeps the estimate
  // fresh between marks without waiting for the next file to complete.
  const timeSinceLastMark = (nowMs ?? performance.now()) - t.lastMarkMs;
  if (timeSinceLastMark > 0 && windowDurationMs > 0) {
    windowDurationMs += timeSinceLastMark;
  }

  if (windowBytes === 0 || windowDurationMs === 0) return null;

  const bytesPerMs = windowBytes / windowDurationMs;
  const bytesRemaining = t.bytesTotal - t.bytesDone;
  return bytesRemaining / bytesPerMs;
};
