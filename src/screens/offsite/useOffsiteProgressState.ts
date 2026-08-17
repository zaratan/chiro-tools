import { useCallback, useRef, useState } from "react";
import {
  createETATracker,
  elapsedMs,
  estimateRemainingMs,
  markFileDone,
  type ETATracker,
} from "../../lib/audio/etaTracker.js";
import { shouldRenderNow } from "../../lib/progress/renderThrottle.js";

/**
 * Beyond this many ms without a single byte more transferred, rclone is
 * assumed to be silently retrying (dead wifi, alive process) rather than
 * stalled or crashed — D3 of the offsite plan. An ETA computed from a
 * window where nothing moved would be actively misleading, so it is
 * withheld instead, and the running screen shows a warning.
 *
 * No wall-clock timer is needed to detect this: rclone's `--stats 1s`
 * emits a tick roughly once a second for as long as the process is alive,
 * dead network or not (see `parseRcloneStats.ts`), so comparing each tick's
 * own arrival time against the last byte-count change is enough.
 */
const STALL_THRESHOLD_MS = 60_000;

export type OffsiteProgressState = {
  bytesTransferred: number;
  elapsedMs: number;
  /** `null` both before a first estimate is possible and for the whole
   * duration of a stall — never a stale number computed on a window where
   * nothing moved. */
  remainingMs: number | null;
  stalled: boolean;
};

type Accumulator = {
  bytesTransferred: number;
  lastByteChangeAtMs: number;
  stalled: boolean;
};

/**
 * Drives the offsite RunningView. Unlike `useArchiveProgressState`, there
 * is exactly one "entry" (the zip being uploaded), so progress is fed by
 * `uploadArchive`'s per-tick cumulative `bytesTransferred` rather than
 * discrete entry-done events — each tick's *delta* over the last known
 * value is fed to the ETA tracker as if it were one small file, so the
 * sliding window still reflects genuine recent throughput.
 *
 * `bytesTransferred` is already clamped monotone by `uploadArchive` itself
 * (D3 of the offsite plan: a retry can walk rclone's own counters
 * backwards), but the clamp here is defense in depth, cheap, and documents
 * the invariant locally rather than trusting a caller.
 *
 * Invariant: `totalBytes` is captured at first render — `RunningView` is
 * mounted exactly once per run with this value frozen, mirroring the same
 * invariant on `useArchiveProgressState` and `useProgressState`.
 */
export const useOffsiteProgressState = (
  totalBytes: number,
  nowFn?: () => number,
): {
  state: OffsiteProgressState;
  onProgress: (bytesTransferred: number) => void;
  /** Forced final render — call SYNCHRONOUSLY right before onComplete(). */
  finalizeRender: () => void;
} => {
  const now = nowFn ?? (() => performance.now());

  const etaTrackerRef = useRef<ETATracker | null>(null);
  etaTrackerRef.current ??= createETATracker(totalBytes, now());

  const accRef = useRef<Accumulator>({
    bytesTransferred: 0,
    lastByteChangeAtMs: now(),
    stalled: false,
  });

  const lastRenderAtRef = useRef<number>(now());

  const [state, setState] = useState<OffsiteProgressState>({
    bytesTransferred: 0,
    elapsedMs: 0,
    remainingMs: null,
    stalled: false,
  });

  const snapshot = useCallback(
    (bytesTransferredOverride?: number): OffsiteProgressState => {
      const tracker = etaTrackerRef.current;
      const nowMs = now();
      const stalled = accRef.current.stalled;
      return {
        bytesTransferred:
          bytesTransferredOverride ?? accRef.current.bytesTransferred,
        elapsedMs: tracker !== null ? elapsedMs(tracker, nowMs) : 0,
        remainingMs:
          stalled || tracker === null
            ? null
            : estimateRemainingMs(tracker, nowMs),
        stalled,
      };
    },
    [],
  );

  const onProgress = useCallback((bytesTransferred: number): void => {
    const nowMs = now();
    const clamped = Math.max(accRef.current.bytesTransferred, bytesTransferred);
    const delta = clamped - accRef.current.bytesTransferred;

    if (delta > 0) {
      const tracker = etaTrackerRef.current;
      if (tracker !== null) markFileDone(tracker, delta, nowMs);
      accRef.current.bytesTransferred = clamped;
      accRef.current.lastByteChangeAtMs = nowMs;
    }

    const wasStalled = accRef.current.stalled;
    const isStalled =
      nowMs - accRef.current.lastByteChangeAtMs >= STALL_THRESHOLD_MS;
    accRef.current.stalled = isStalled;

    // Bypasses the render throttle on genuine progress or a stall
    // transition — either is news, not the routine ~10 Hz cadence the
    // throttle exists to cap.
    if (
      delta > 0 ||
      isStalled !== wasStalled ||
      shouldRenderNow(lastRenderAtRef.current, nowMs)
    ) {
      setState(snapshot());
      lastRenderAtRef.current = nowMs;
    }
  }, []);

  // bytesTransferred is forced to totalBytes so the bar reaches 100 % even
  // when the throttle dropped the last few onProgress setStates.
  const finalizeRender = useCallback((): void => {
    lastRenderAtRef.current = now();
    accRef.current.stalled = false;
    setState(snapshot(totalBytes));
  }, []);

  return { state, onProgress, finalizeRender };
};
