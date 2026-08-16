import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ArchivedVolume,
  VolumeProgressEvent,
} from "../../lib/archive/createZipVolumes.js";
import type { ArchiveEntryStat } from "../../lib/archive/planArchive.js";
import { extractErrorCode } from "../../lib/fs/safeFsOps.js";
import { logSession } from "../../lib/logging/log.js";
import type { SessionEvent } from "../../types.js";
import type { RunningViewHandles } from "./RunningView.js";

export type { ArchivedVolume, VolumeProgressEvent };

/**
 * Which destination a Confirmation/Constat/RunningView instance is wired
 * for. Copy-only discriminant: every screen branches on
 * it purely for wording, never for behavior — behavior is always the
 * injected `runner`/`resolveTargetName`/`buildSessionEvent` triplet.
 */
export type ArchiveFlowMode = "backup" | "package";

/** Result of the single-zip backup flow (`createZipArchive`, wrapped by
 * `createBackupBehavior`). */
export type BackupOkResult = {
  kind: "backup-ok";
  zipPath: string;
  zipBytes: number;
  entryCount: number;
  durationMs: number;
  /** Carried through to the session log. The backup zip — not the deposit
   * series — is the artifact a future "upload then delete the source" flow
   * would act on, so this is the flow that most needs the guarantee. */
  durable: boolean;
};

/** Result of the multi-volume upload-series flow (`createZipVolumes`,
 * wrapped by `createPackageBehavior`). */
export type PackageOkResult = {
  kind: "package-ok";
  seriesDirPath: string;
  seriesDirName: string;
  volumes: ArchivedVolume[];
  entryCount: number;
  totalZipBytes: number;
  durationMs: number;
  durable: boolean;
};

/**
 * The two ways a run can fail. Shared by both flows on purpose: neither
 * carries anything that would identify which one produced it, which is
 * exactly why the session-event builder has to be injected rather than
 * inferred from `kind`.
 */
export type ArchiveRunFailure =
  { kind: "aborted" } | { kind: "error"; code: string };

/**
 * A run's outcome, parameterized by the flow's own success shape, so each
 * consumer only ever sees its own — mis-wiring is a compile error rather
 * than a branch nothing can reach.
 *
 * The `${string}-ok` constraint is load-bearing: it keeps the success shapes
 * disjoint from `"aborted"`/`"error"`, so narrowing on `kind` still works.
 */
export type ArchiveOkResult = { kind: `${string}-ok` };

export type ArchiveRunnerResult<TOk extends ArchiveOkResult> =
  TOk | ArchiveRunFailure;

/** The non-error outcomes `useArchiveRun` hands to `onComplete` — an
 * "error" outcome is handled internally as `run-error` state instead. */
export type ArchiveRunOutcome<TOk extends ArchiveOkResult> =
  TOk | { kind: "aborted" };

export type ResolvedNamePreview = { name: string; alreadyExists: boolean };

/**
 * Resolves the name shown on the confirmation screen (a file name for the
 * backup flow, a series directory name for the package flow) plus whether
 * the target directory already holds an artifact from a previous run — the
 * conditional reassurance line both A-Confirmation and its upload variant
 * show. Called once on mount, and again right before the real run starts to
 * narrow the collision window (the minute/day may have turned since the
 * preview rendered).
 */
export type ResolveTargetName = () => Promise<ResolvedNamePreview>;

/**
 * The injected "runner": wraps either `createZipArchive` (backup) or
 * `createZipVolumes` (package) behind one shared shape, so `useArchiveRun`
 * never has to know which one it's driving.
 * `entries` is passed at call time (not baked into the closure) so a retry
 * always uses the exact same batch the screen was shown for.
 */
export type ArchiveRunner<TOk extends ArchiveOkResult> = (opts: {
  entries: readonly ArchiveEntryStat[];
  signal: AbortSignal;
  onProgress: (event: VolumeProgressEvent) => void;
}) => Promise<ArchiveRunnerResult<TOk>>;

/**
 * The injected session-log builder. Takes this flow's own success shape plus
 * the shared failures — never the other flow's success. The "aborted"/
 * "error" branches carry no information distinguishing which flow produced
 * them, which is exactly why this is injected rather than inferred from
 * `result.kind` alone.
 */
export type BuildRunSessionEvent<TOk extends ArchiveOkResult> = (
  result: ArchiveRunnerResult<TOk>,
  entryCount: number,
  totalBytes: number,
  durationMs: number,
  cwd: string,
) => SessionEvent;

export type ArchiveConfirmState =
  | { kind: "loading" }
  | { kind: "preview"; name: string; alreadyExists: boolean }
  | { kind: "running" }
  | {
      /**
       * Entered the moment the user requests a cancellation, before the
       * runner's promise has actually resolved. `createZipVolumes` destroys
       * its staging directory (possibly several GiB) before returning
       * "aborted" — 10 to 60 s on an external disk — during which the last
       * known progress would otherwise stay frozen on screen with Ctrl+C
       * appearing inert, indistinguishable from a crash.
       * Harmless for the backup flow, whose abort path only unlinks a
       * single `.tmp` file: the state is entered and left again almost
       * immediately there.
       */
      kind: "cleaning";
    }
  | { kind: "run-error"; code: string };

export type UseArchiveRunOptions<TOk extends ArchiveOkResult> = {
  cwd: string;
  entries: readonly ArchiveEntryStat[];
  totalBytes: number;
  /** Mutated during the run; consulted by the App-level Ctrl+C handler. */
  runningRef: React.RefObject<boolean>;
  /** Injected — see {@link ArchiveRunner}. */
  runner: ArchiveRunner<TOk>;
  /** Injected — see {@link ResolveTargetName}. */
  resolveTargetName: ResolveTargetName;
  /** Injected — see {@link BuildRunSessionEvent}. */
  buildSessionEvent: BuildRunSessionEvent<TOk>;
  onComplete: (outcome: ArchiveRunOutcome<TOk>) => void;
};

export type UseArchiveRunResult = {
  state: ArchiveConfirmState;
  startArchive: () => Promise<void>;
  /** Aborts the in-flight run, e.g. on Ctrl+C. No-op outside of a run. */
  abort: () => void;
  /**
   * Returns from `run-error` to the confirmation preview, re-resolving the
   * target name (the minute/day may have turned, or a collision may be
   * gone). Only offered by the UI for transient error codes — see
   * `isTransientArchiveError` in `errorMessages.ts`.
   */
  retry: () => void;
  /** Wire up as `RunningView`'s `onMount` to receive its imperative handles. */
  registerRunningViewHandles: (handles: RunningViewHandles) => void;
};

/**
 * Orchestrates an archive run: name resolution preview, zip/series creation,
 * session logging, and completion/error/cleaning state transitions. Kept out
 * of ConfirmScreen so the screen stays display + navigation only. Mirrors
 * `useVigieProcessRun`.
 *
 * Deliberately mode-agnostic: it knows nothing about
 * "backup" vs "package" — that distinction lives entirely in which
 * `runner`/`resolveTargetName`/`buildSessionEvent` triplet the caller
 * injects. `app.tsx` picks the triplet at routing time.
 */
export const useArchiveRun = <TOk extends ArchiveOkResult>({
  cwd,
  entries,
  totalBytes,
  runningRef,
  runner,
  resolveTargetName,
  buildSessionEvent,
  onComplete,
}: UseArchiveRunOptions<TOk>): UseArchiveRunResult => {
  const [state, setState] = useState<ArchiveConfirmState>({ kind: "loading" });
  const controllerRef = useRef<AbortController | null>(null);
  const runningHandlesRef = useRef<RunningViewHandles | null>(null);
  // Synchronous latch, deliberately not state: `state` only flips to
  // "running" several awaits in, so two Entrée keypresses delivered in the
  // same tick (key auto-repeat) would both pass a state-based guard and race
  // two runs onto the same tmp/staging path.
  const startedRef = useRef(false);

  const resolvePreview = useCallback(
    async (isStale: () => boolean): Promise<void> => {
      const preview = await resolveTargetName();
      if (isStale()) return;
      setState({
        kind: "preview",
        name: preview.name,
        alreadyExists: preview.alreadyExists,
      });
    },
    [resolveTargetName],
  );

  useEffect(() => {
    let cancelled = false;
    void resolvePreview(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [resolvePreview]);

  useEffect(() => {
    return () => {
      if (controllerRef.current) {
        controllerRef.current.abort();
      }
      runningRef.current = false;
    };
  }, [runningRef]);

  const startArchive = async (): Promise<void> => {
    if (startedRef.current || state.kind !== "preview") return;
    startedRef.current = true;

    const controller = new AbortController();
    controllerRef.current = controller;
    runningRef.current = true;
    setState({ kind: "running" });

    const startedAt = performance.now();

    let result: ArchiveRunnerResult<TOk>;
    try {
      result = await runner({
        entries,
        signal: controller.signal,
        onProgress: (event: VolumeProgressEvent) => {
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
        buildSessionEvent(result, entries.length, totalBytes, durationMs, cwd),
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
    if (state.kind !== "running") return;
    setState({ kind: "cleaning" });
    controllerRef.current?.abort();
  };

  const retry = (): void => {
    if (state.kind !== "run-error") return;
    startedRef.current = false;
    setState({ kind: "loading" });
    void resolvePreview(() => false);
  };

  const registerRunningViewHandles = (handles: RunningViewHandles): void => {
    runningHandlesRef.current = handles;
  };

  return { state, startArchive, abort, retry, registerRunningViewHandles };
};
