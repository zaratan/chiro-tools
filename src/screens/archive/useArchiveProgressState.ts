import { useCallback, useRef, useState } from "react";
import {
  createETATracker,
  elapsedMs,
  estimateRemainingMs,
  markFileDone,
  type ETATracker,
} from "../../lib/audio/etaTracker.js";
import type { ArchiveProgressEvent } from "../../lib/archive/createZipArchive.js";
import type { ArchiveEntryStat } from "../../lib/archive/planArchive.js";

export type ArchiveProgressState = {
  totalEntries: number;
  currentEntryName: string | null;
  currentEntryIndex: number | null;
  bytesRead: number;
  elapsedMs: number;
  remainingMs: number | null;
};

type ArchiveProgressAccumulator = {
  currentEntryName: string | null;
  currentEntryIndex: number | null;
  bytesRead: number;
};

// ~10 Hz, same rationale as vigie-process's useProgressState.
const THROTTLE_MS = 100;

/**
 * Drives the running view of the « Créer un zip » flow. Byte-weighted, like
 * `useProgressState` for the découpage flow, but keyed on two different
 * granularities: the progress bar tracks `bytes-read` events (fired per 1
 * MiB block read from source, robust to deflate's variable compression
 * ratio — D5), while the ETA tracker is fed once per `entry-done` with that
 * entry's full size, mirroring the per-file cadence `useProgressState` uses
 * with `markFileDone`.
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
  onProgress: (event: ArchiveProgressEvent) => void;
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
  });

  const lastRenderAtRef = useRef<number>(now());

  const [state, setState] = useState<ArchiveProgressState>({
    totalEntries: entries.length,
    currentEntryName: null,
    currentEntryIndex: null,
    bytesRead: 0,
    elapsedMs: 0,
    remainingMs: null,
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
      };
    },
    [],
  );

  const onProgress = useCallback((event: ArchiveProgressEvent): void => {
    if (event.kind === "entry-start") {
      accRef.current.currentEntryName = event.entryName;
      accRef.current.currentEntryIndex = event.entryIndex;
      setState(snapshot());
      lastRenderAtRef.current = now();
    } else if (event.kind === "bytes-read") {
      accRef.current.bytesRead = event.totalBytesRead;
      const nowMs = now();
      if (nowMs - lastRenderAtRef.current > THROTTLE_MS) {
        setState(snapshot());
        lastRenderAtRef.current = nowMs;
      }
    } else {
      const tracker = etaTrackerRef.current;
      const entry = entries[event.entryIndex];
      if (tracker !== null && entry !== undefined) {
        markFileDone(tracker, entry.size);
      }
      setState(snapshot());
      lastRenderAtRef.current = now();
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
