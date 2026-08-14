import { useCallback, useRef, useState } from "react";
import {
  createETATracker,
  elapsedMs,
  estimateRemainingMs,
  markFileDone,
  type ETATracker,
} from "../../lib/audio/etaTracker.js";
import type { VolumeProgressEvent } from "../../lib/archive/createZipVolumes.js";
import type { ArchiveEntryStat } from "../../lib/archive/planArchive.js";
import { assertUnreachable } from "../../lib/exhaustive.js";
import { shouldRenderNow } from "../../lib/progress/renderThrottle.js";

export type ArchiveProgressState = {
  totalEntries: number;
  currentEntryName: string | null;
  currentEntryIndex: number | null;
  bytesRead: number;
  elapsedMs: number;
  remainingMs: number | null;
  /** Set on the upload-series flow's `volume-start` events, 1-based. `null`
   * for the backup flow, which never emits them. */
  volumeIndex: number | null;
};

type ArchiveProgressAccumulator = {
  currentEntryName: string | null;
  currentEntryIndex: number | null;
  bytesRead: number;
  volumeIndex: number | null;
};

/**
 * Drives the running view of both the « Créer un zip » (backup) and the
 * upload-series flows. Byte-weighted, like `useProgressState` for the
 * découpage flow, but keyed on two different granularities: the progress
 * bar tracks `bytes-read` events (fired per 1 MiB block read from source,
 * robust to deflate's variable compression ratio — D5), while the ETA
 * tracker is fed once per `entry-done` with that entry's full size,
 * mirroring the per-file cadence `useProgressState` uses with
 * `markFileDone`.
 *
 * Accepts `VolumeProgressEvent`, a superset of `ArchiveProgressEvent` adding
 * `volume-start` (phase-9 plan, D6) — the backup flow's runner never emits
 * it, so `volumeIndex` simply stays `null` there.
 *
 * Invariant: `entries` and `totalBytes` are captured at first render.
 * RunningView is mounted exactly once per run with these values frozen, so
 * the empty `useCallback([])` deps below are safe — see the same invariant
 * documented on `useProgressState`.
 */
export const useArchiveProgressState = (
  entries: readonly ArchiveEntryStat[],
  totalBytes: number,
  nowFn?: () => number,
): {
  state: ArchiveProgressState;
  onProgress: (event: VolumeProgressEvent) => void;
  /** Forced final render — call SYNCHRONOUSLY right before onComplete(). */
  finalizeRender: () => void;
} => {
  const now = nowFn ?? (() => performance.now());

  const etaTrackerRef = useRef<ETATracker | null>(null);
  etaTrackerRef.current ??= createETATracker(totalBytes, now());

  const accRef = useRef<ArchiveProgressAccumulator>({
    currentEntryName: null,
    currentEntryIndex: null,
    bytesRead: 0,
    volumeIndex: null,
  });

  const lastRenderAtRef = useRef<number>(now());

  const [state, setState] = useState<ArchiveProgressState>({
    totalEntries: entries.length,
    currentEntryName: null,
    currentEntryIndex: null,
    bytesRead: 0,
    elapsedMs: 0,
    remainingMs: null,
    volumeIndex: null,
  });

  const snapshot = useCallback(
    (bytesReadOverride?: number): ArchiveProgressState => {
      const tracker = etaTrackerRef.current;
      const nowMs = now();
      return {
        totalEntries: entries.length,
        currentEntryName: accRef.current.currentEntryName,
        currentEntryIndex: accRef.current.currentEntryIndex,
        bytesRead: bytesReadOverride ?? accRef.current.bytesRead,
        elapsedMs: tracker !== null ? elapsedMs(tracker, nowMs) : 0,
        remainingMs:
          tracker !== null ? estimateRemainingMs(tracker, nowMs) : null,
        volumeIndex: accRef.current.volumeIndex,
      };
    },
    [],
  );

  const onProgress = useCallback((event: VolumeProgressEvent): void => {
    switch (event.kind) {
      case "volume-start":
        accRef.current.volumeIndex = event.volumeIndex;
        setState(snapshot());
        lastRenderAtRef.current = now();
        return;
      case "entry-start":
        accRef.current.currentEntryName = event.entryName;
        accRef.current.currentEntryIndex = event.entryIndex;
        setState(snapshot());
        lastRenderAtRef.current = now();
        return;
      case "bytes-read": {
        accRef.current.bytesRead = event.totalBytesRead;
        const nowMs = now();
        if (shouldRenderNow(lastRenderAtRef.current, nowMs)) {
          setState(snapshot());
          lastRenderAtRef.current = nowMs;
        }
        return;
      }
      case "entry-done": {
        const tracker = etaTrackerRef.current;
        const entry = entries[event.entryIndex];
        if (tracker !== null && entry !== undefined) {
          markFileDone(tracker, entry.size);
        }
        setState(snapshot());
        lastRenderAtRef.current = now();
        return;
      }
      default:
        assertUnreachable(event);
    }
  }, []);

  // bytesRead is forced to totalBytes so the bar reaches 100 % even when the
  // 100 ms throttle dropped the last few bytes-read setStates.
  const finalizeRender = useCallback((): void => {
    lastRenderAtRef.current = now();
    setState(snapshot(totalBytes));
  }, []);

  return { state, onProgress, finalizeRender };
};
