// ~10 Hz — fast enough for the human eye to perceive progress, slow enough to
// not saturate Ink's renderer when a run produces dozens of events per second.
export const THROTTLE_MS = 100;

export const shouldRenderNow = (
  lastRenderAtMs: number,
  nowMs: number,
): boolean => nowMs - lastRenderAtMs > THROTTLE_MS;
