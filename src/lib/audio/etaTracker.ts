export type ETATracker = {
  startedAtMs: number;
  bytesDone: number;
  bytesTotal: number;
};

export const createETATracker = (
  bytesTotal: number,
  nowMs?: number,
): ETATracker => ({
  startedAtMs: nowMs ?? performance.now(),
  bytesDone: 0,
  bytesTotal,
});

export const markFileDone = (t: ETATracker, fileSizeBytes: number): void => {
  t.bytesDone += fileSizeBytes;
};

export const elapsedMs = (t: ETATracker, nowMs?: number): number =>
  (nowMs ?? performance.now()) - t.startedAtMs;

export const estimateRemainingMs = (
  t: ETATracker,
  nowMs?: number,
): number | null => {
  if (t.bytesDone === 0) return null;
  const elapsed = elapsedMs(t, nowMs);
  const bytesRemaining = t.bytesTotal - t.bytesDone;
  return elapsed * (bytesRemaining / t.bytesDone);
};
