import { useEffect, useRef, useState } from "react";
import { estimateChunkCount } from "../../lib/audio/estimateChunks.js";
import type {
  ProcessOptions,
  ProcessResult,
  processWavFiles as ProcessWavFilesType,
} from "../../lib/audio/processWavFiles.js";
import { describeError } from "../../lib/errors/describeError.js";
import { buildVigieProcessSessionEvent } from "../../lib/logging/buildVigieProcessSessionEvent.js";
import { logSession } from "../../lib/logging/log.js";
import { metadataEnabled } from "../../lib/runtime/metadataEnabled.js";
import type { ProcessInput } from "../../types.js";
import { CHIRO_VERSION } from "../../version.js";
import type { RunningViewHandles } from "./RunningView.js";

export type ProcessWavFilesFn = typeof ProcessWavFilesType;

export type ConfirmState =
  | { kind: "loading" }
  | {
      kind: "preview";
      totalChunks: number;
      totalDurationSec: number;
      totalBytes: number;
    }
  | {
      kind: "running";
      totalChunks: number;
      totalBytes: number;
    }
  | { kind: "run-error"; code: string };

export type UseVigieProcessRunOptions = {
  cwd: string;
  input: ProcessInput;
  wavFiles: string[];
  /** Mutated during the run; consulted by the App-level Ctrl+C handler. */
  runningRef: React.RefObject<boolean>;
  /** Injected for tests. Defaults to the real implementation. */
  processWavFiles: ProcessWavFilesFn;
  onComplete: (outcome: ProcessResult) => void;
};

export type UseVigieProcessRunResult = {
  state: ConfirmState;
  startProcess: () => Promise<void>;
  /** Aborts the in-flight run, e.g. on Ctrl+C. No-op outside of a run. */
  abort: () => void;
  /** Wire up as `RunningView`'s `onMount` to receive its imperative handles. */
  registerRunningViewHandles: (handles: RunningViewHandles) => void;
};

/**
 * Orchestrates a vigie-process run: pre-flight chunk estimate, split,
 * session logging, and completion/error state transitions. Kept out of
 * ConfirmScreen so the screen stays display + navigation only.
 */
export const useVigieProcessRun = ({
  cwd,
  input,
  wavFiles,
  runningRef,
  processWavFiles,
  onComplete,
}: UseVigieProcessRunOptions): UseVigieProcessRunResult => {
  const [state, setState] = useState<ConfirmState>({ kind: "loading" });
  const controllerRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);

  // Stable ref to RunningView handles — set once via onMount callback.
  const runningHandlesRef = useRef<RunningViewHandles | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void estimateChunkCount(wavFiles, cwd, input.mode, controller.signal).then(
      (estimate) => {
        if (cancelled) return;
        setState({
          kind: "preview",
          totalChunks: estimate.totalChunks,
          totalDurationSec: estimate.totalDurationSec,
          totalBytes: estimate.totalBytes,
        });
      },
    );
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [cwd, input.mode, wavFiles]);

  useEffect(() => {
    return () => {
      if (controllerRef.current) {
        controllerRef.current.abort();
      }
      runningRef.current = false;
    };
  }, [runningRef]);

  const startProcess = async (): Promise<void> => {
    if (state.kind !== "preview") return;
    // Synchronous latch, deliberately not state: `state` only flips to
    // "running" several awaits in, so two Entrée events delivered in the same
    // tick (key auto-repeat, impatient double-tap on a slow folder) would both
    // pass a state-based guard. Two concurrent runs then `rm -rf` each other's
    // sox scratch directory and `cleanPartialOutput` deletes chunks the other
    // just wrote. Same latch as `useArchiveRun`.
    if (startedRef.current) return;
    startedRef.current = true;
    const { totalChunks, totalBytes } = state;

    const controller = new AbortController();
    controllerRef.current = controller;
    runningRef.current = true;
    setState({ kind: "running", totalChunks, totalBytes });

    const options: ProcessOptions = {
      signal: controller.signal,
      onProgress: (event) => {
        runningHandlesRef.current?.onProgress(event);
      },
      metadata: {
        enabled: metadataEnabled(),
        chiroVersion: CHIRO_VERSION,
      },
    };

    let outcome: ProcessResult;
    try {
      outcome = await processWavFiles(wavFiles, cwd, input, options);
    } catch (err) {
      runningRef.current = false;
      controllerRef.current = null;
      setState({ kind: "run-error", code: describeError(err) });
      return;
    }

    // Synchronous finalize — forces bar to 100 % before unmount.
    runningHandlesRef.current?.finalizeRender();

    try {
      await logSession(buildVigieProcessSessionEvent(input, outcome, cwd));
    } catch {
      // Local log is best-effort — never block the UI on a write failure.
    }

    runningRef.current = false;
    controllerRef.current = null;
    onComplete(outcome);
  };

  const abort = (): void => {
    controllerRef.current?.abort();
  };

  const registerRunningViewHandles = (handles: RunningViewHandles): void => {
    runningHandlesRef.current = handles;
  };

  return { state, startProcess, abort, registerRunningViewHandles };
};
