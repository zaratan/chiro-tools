import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { useEffect, useRef, useState } from "react";
import {
  type ArchiveProgressEvent,
  type CreateZipArchiveResult,
  type createZipArchive as CreateZipArchiveType,
} from "../../lib/archive/createZipArchive.js";
import {
  buildArchiveName,
  resolveArchiveFileName,
  type ArchiveEntryStat,
} from "../../lib/archive/planArchive.js";
import { extractErrorCode } from "../../lib/fs/safeFsOps.js";
import { buildArchiveSessionEvent } from "../../lib/logging/buildArchiveSessionEvent.js";
import { logSession } from "../../lib/logging/log.js";
import type { RunningViewHandles } from "./RunningView.js";

export type CreateZipArchiveFn = typeof CreateZipArchiveType;

/** The two non-error outcomes `useArchiveRun` hands to `onComplete` — an
 * "error" outcome is handled internally as `run-error` state instead. */
export type ArchiveRunOutcome = Extract<
  CreateZipArchiveResult,
  { kind: "ok" } | { kind: "aborted" }
>;

export type ArchiveConfirmState =
  | { kind: "loading" }
  | { kind: "preview"; fileName: string; zipAlreadyExists: boolean }
  | { kind: "running"; fileName: string }
  | { kind: "run-error"; code: string };

export type UseArchiveRunOptions = {
  cwd: string;
  processedDir: string;
  archivedDir: string;
  entries: readonly ArchiveEntryStat[];
  totalBytes: number;
  /** Mutated during the run; consulted by the App-level Ctrl+C handler. */
  runningRef: React.RefObject<boolean>;
  /** Injected for tests. Defaults to the real implementation. */
  createZipArchive: CreateZipArchiveFn;
  onComplete: (outcome: ArchiveRunOutcome) => void;
};

export type UseArchiveRunResult = {
  state: ArchiveConfirmState;
  startArchive: () => Promise<void>;
  /** Aborts the in-flight run, e.g. on Ctrl+C. No-op outside of a run. */
  abort: () => void;
  /** Wire up as `RunningView`'s `onMount` to receive its imperative handles. */
  registerRunningViewHandles: (handles: RunningViewHandles) => void;
};

const ARCHIVE_ZIP_NAME_REGEX = /^processed_\d{12}(-\d+)?\.zip$/;

/**
 * Whether `archivedDir` already holds a zip from a previous run — drives the
 * Confirmation screen's "un zip existe déjà" reassurance line. Distinct from
 * `resolveArchiveFileName`'s collision check: that one only tells us whether
 * *this run's exact minute-stamped name* collides, not whether the folder
 * has older zips in it.
 */
export const hasExistingArchiveZip = async (
  archivedDir: string,
): Promise<boolean> => {
  try {
    const dirEntries = await readdir(archivedDir);
    return dirEntries.some((name) => ARCHIVE_ZIP_NAME_REGEX.test(name));
  } catch {
    return false;
  }
};

/**
 * Orchestrates a vigie-archive run: name resolution preview, zip creation,
 * session logging, and completion/error state transitions. Kept out of
 * ConfirmScreen so the screen stays display + navigation only. Mirrors
 * `useVigieProcessRun`.
 */
export const useArchiveRun = ({
  cwd,
  processedDir,
  archivedDir,
  entries,
  totalBytes,
  runningRef,
  createZipArchive,
  onComplete,
}: UseArchiveRunOptions): UseArchiveRunResult => {
  const [state, setState] = useState<ArchiveConfirmState>({ kind: "loading" });
  const controllerRef = useRef<AbortController | null>(null);
  const runningHandlesRef = useRef<RunningViewHandles | null>(null);

  useEffect(() => {
    let cancelled = false;
    const baseName = buildArchiveName(new Date());
    void Promise.all([
      resolveArchiveFileName(archivedDir, baseName),
      hasExistingArchiveZip(archivedDir),
    ]).then(([resolved, zipAlreadyExists]) => {
      if (cancelled) return;
      const fileName = resolved.kind === "ok" ? resolved.fileName : baseName;
      setState({ kind: "preview", fileName, zipAlreadyExists });
    });
    return () => {
      cancelled = true;
    };
  }, [archivedDir]);

  useEffect(() => {
    return () => {
      if (controllerRef.current) {
        controllerRef.current.abort();
      }
      runningRef.current = false;
    };
  }, [runningRef]);

  const startArchive = async (): Promise<void> => {
    if (state.kind !== "preview") return;

    const controller = new AbortController();
    controllerRef.current = controller;
    runningRef.current = true;

    const startedAt = performance.now();

    try {
      await mkdir(archivedDir, { recursive: true });
    } catch (err) {
      runningRef.current = false;
      controllerRef.current = null;
      setState({ kind: "run-error", code: `mkdir:${extractErrorCode(err)}` });
      return;
    }

    // Re-resolve right before the real run, narrowing the collision window
    // between the preview render and the user pressing Entrée.
    const baseName = buildArchiveName(new Date());
    const resolved = await resolveArchiveFileName(archivedDir, baseName);
    if (resolved.kind !== "ok") {
      runningRef.current = false;
      controllerRef.current = null;
      setState({ kind: "run-error", code: "collision-exhausted" });
      return;
    }

    const zipPath = path.join(archivedDir, resolved.fileName);
    setState({ kind: "running", fileName: resolved.fileName });

    let result: CreateZipArchiveResult;
    try {
      result = await createZipArchive({
        sourceDir: processedDir,
        entries,
        zipPath,
        signal: controller.signal,
        onProgress: (event: ArchiveProgressEvent) => {
          runningHandlesRef.current?.onProgress(event);
        },
      });
    } catch (err) {
      runningRef.current = false;
      controllerRef.current = null;
      setState({ kind: "run-error", code: extractErrorCode(err) });
      return;
    }

    // Synchronous finalize — forces bar to 100 % before unmount.
    runningHandlesRef.current?.finalizeRender();

    const durationMs = performance.now() - startedAt;
    try {
      await logSession(
        buildArchiveSessionEvent(
          result,
          entries.length,
          totalBytes,
          durationMs,
          cwd,
        ),
      );
    } catch {
      // Local log is best-effort — never block the UI on a write failure.
    }

    runningRef.current = false;
    controllerRef.current = null;

    if (result.kind === "error") {
      setState({ kind: "run-error", code: result.code });
      return;
    }

    onComplete(result);
  };

  const abort = (): void => {
    controllerRef.current?.abort();
  };

  const registerRunningViewHandles = (handles: RunningViewHandles): void => {
    runningHandlesRef.current = handles;
  };

  return { state, startArchive, abort, registerRunningViewHandles };
};
