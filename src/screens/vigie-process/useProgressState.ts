import { useCallback, useRef, useState } from "react";
import {
  createETATracker,
  elapsedMs,
  estimateRemainingMs,
  markFileDone,
} from "../../lib/audio/etaTracker.js";
import type { ETATracker } from "../../lib/audio/etaTracker.js";
import type { ProgressEvent } from "../../types.js";

export type ProgressState = {
  filesTotal: number;
  currentFileName: string | null;
  currentFileIndex: number | null;
  chunksWritten: number;
  totalChunksEstimate: number;
  elapsedMs: number;
  remainingMs: number | null;
};

type ProgressAccumulator = {
  currentFileName: string | null;
  currentFileIndex: number | null;
  chunksWritten: number;
};

// ~10 Hz — fast enough for the human eye to perceive progress, slow enough to
// not saturate Ink's renderer when a file produces 20+ chunks per second.
const THROTTLE_MS = 100;

/**
 * Drives the running view of the « Découper » flow.
 *
 * Invariant: `totalFiles`, `totalChunksEstimate`, and `totalBytes` are
 * captured at first render. RunningView is mounted exactly once per run with
 * these values frozen, so the empty `useCallback([])` deps below are safe.
 * If this hook ever gains a callsite where those props mutate, the callbacks
 * must move to ref-based access or carry the values in their deps array.
 */
export const useProgressState = (
  totalFiles: number,
  totalChunksEstimate: number,
  totalBytes: number,
  nowFn?: () => number,
): {
  state: ProgressState;
  onProgress: (event: ProgressEvent) => void;
  /** Forced final render — call SYNCHRONOUSLY right before onComplete(). */
  finalizeRender: () => void;
} => {
  const now = nowFn ?? (() => performance.now());

  const etaTrackerRef = useRef<ETATracker | null>(null);
  etaTrackerRef.current ??= createETATracker(totalBytes, now());

  const progressRef = useRef<ProgressAccumulator>({
    currentFileName: null,
    currentFileIndex: null,
    chunksWritten: 0,
  });

  const lastRenderAtRef = useRef<number>(now());

  const [state, setState] = useState<ProgressState>({
    filesTotal: totalFiles,
    currentFileName: null,
    currentFileIndex: null,
    chunksWritten: 0,
    totalChunksEstimate,
    elapsedMs: 0,
    remainingMs: null,
  });

  const snapshot = useCallback(
    (chunksWrittenOverride?: number): ProgressState => {
      const tracker = etaTrackerRef.current;
      const nowMs = now();
      return {
        filesTotal: totalFiles,
        currentFileName: progressRef.current.currentFileName,
        currentFileIndex: progressRef.current.currentFileIndex,
        chunksWritten:
          chunksWrittenOverride ?? progressRef.current.chunksWritten,
        totalChunksEstimate,
        elapsedMs: tracker !== null ? elapsedMs(tracker, nowMs) : 0,
        remainingMs:
          tracker !== null ? estimateRemainingMs(tracker, nowMs) : null,
      };
    },
    [],
  );

  const onProgress = useCallback((event: ProgressEvent): void => {
    if (event.kind === "file-start") {
      progressRef.current.currentFileName = event.fileName;
      progressRef.current.currentFileIndex = event.fileIndex;
      setState(snapshot());
      lastRenderAtRef.current = now();
    } else if (event.kind === "chunk-written") {
      progressRef.current.chunksWritten += 1;
      const nowMs = now();
      if (nowMs - lastRenderAtRef.current > THROTTLE_MS) {
        setState(snapshot());
        lastRenderAtRef.current = nowMs;
      }
    } else {
      const tracker = etaTrackerRef.current;
      if (tracker !== null) {
        markFileDone(tracker, event.fileSizeBytes);
      }
      setState(snapshot());
      lastRenderAtRef.current = now();
    }
  }, []);

  // chunksWritten is forced to the estimate so the bar reaches 100 % even
  // when our pre-flight estimate undershot the real chunk count (or when the
  // 100 ms throttle dropped the last few chunk-written setStates).
  const finalizeRender = useCallback((): void => {
    lastRenderAtRef.current = now();
    setState(snapshot(totalChunksEstimate));
  }, []);

  return { state, onProgress, finalizeRender };
};
