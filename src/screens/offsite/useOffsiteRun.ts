import { useCallback, useEffect, useRef, useState } from "react";
import { extractErrorCode } from "../../lib/fs/safeFsOps.js";
import {
  buildOffsiteSessionEvent,
  type OffsiteSessionOutcome,
} from "../../lib/logging/buildOffsiteSessionEvent.js";
import { logSession } from "../../lib/logging/log.js";
import type { ChosenArchive } from "../../lib/offsite/pickArchiveToUpload.js";
import { remoteStat } from "../../lib/offsite/remoteStat.js";
import type { OffsiteSettings } from "../../lib/offsite/settings.js";
import {
  nodeRcloneSpawn,
  uploadArchive as defaultUploadArchive,
  type UploadArchiveDeps,
  type UploadArchiveOptions,
  type UploadArchiveResult,
} from "../../lib/offsite/uploadArchive.js";
import type { RunningViewHandles } from "./RunningView.js";

export type UploadArchiveFn = (
  deps: UploadArchiveDeps,
  options: UploadArchiveOptions,
) => Promise<UploadArchiveResult>;

export type OffsiteRunOkOutcome = {
  kind: "ok";
  zipName: string;
  zipBytes: number;
  verified: "size-match" | "unavailable";
  finishedAtMs: number;
  durationMs: number;
};

/** The non-error outcomes this hook hands to `onComplete` — a `run-error`
 * outcome is handled internally as run-error `state` instead, mirroring
 * `useArchiveRun`'s own `ArchiveRunOutcome`. */
export type OffsiteRunOutcome = OffsiteRunOkOutcome | { kind: "aborted" };

export type OffsiteRunState =
  | { kind: "running" }
  /** Entered the moment Ctrl+C fires, before `uploadArchive`'s promise has
   * resolved. `uploadArchive` owns its own SIGINT-resend/SIGKILL escalation
   * internally (D4 of the offsite plan) — this hook adds none of its own,
   * it only stops showing progress data that stopped being trustworthy the
   * instant the abort was requested. */
  | { kind: "stopping" }
  /** `zipBytes` rides along so the run-error screen can estimate "combien
   * de temps ça va reprendre" without needing `chosen` passed back in. */
  | { kind: "run-error"; code: string; zipBytes: number };

export type UseOffsiteRunOptions = {
  cwd: string;
  chosen: ChosenArchive;
  binPath: string;
  settings: OffsiteSettings;
  /** Mutated during the run; consulted by the App-level Ctrl+C handler. */
  runningRef: React.RefObject<boolean>;
  platform?: NodeJS.Platform;
  /** Injected for tests. Defaults to the real `uploadArchive`. Everything
   * it spawns internally (rclone itself, the post-transfer HEAD) is a
   * lib-level concern already covered by 10.A2's own tests — this is the
   * one seam a screen-level test needs. */
  uploadArchive?: UploadArchiveFn;
  onComplete: (outcome: OffsiteRunOutcome) => void;
};

export type UseOffsiteRunResult = {
  state: OffsiteRunState;
  /** Requests the in-flight transfer stop, e.g. on Ctrl+C. No-op outside of
   * "running" — a second Ctrl+C while already "stopping" does nothing here;
   * `uploadArchive` is what actually escalates. */
  abort: () => void;
  /** Restarts the same transfer from byte 0 — there is no multipart resume
   * (A3 of the offsite plan). Only meaningful from `run-error`. */
  retry: () => void;
  /** Wire up as `RunningView`'s `onMount` to receive its imperative
   * handles. */
  registerRunningViewHandles: (handles: RunningViewHandles) => void;
};

const buildRemoteKey = (settings: OffsiteSettings, name: string): string =>
  `${settings.prefix}/${name}`;

const buildSessionOutcome = (
  result: UploadArchiveResult,
  chosen: ChosenArchive,
  settings: OffsiteSettings,
): OffsiteSessionOutcome => {
  if (result.kind === "ok") {
    return {
      kind: "ok",
      zipName: chosen.name,
      zipBytes: chosen.size,
      remote: settings.remote,
      bucket: settings.bucket,
      remoteKey: buildRemoteKey(settings, chosen.name),
      verified: result.verified,
      attempts: result.attempts,
    };
  }
  if (result.kind === "aborted") {
    return {
      kind: "aborted",
      zipName: chosen.name,
      zipBytes: chosen.size,
      bytesSent: result.bytesSent,
    };
  }
  return {
    kind: "error",
    code: result.code,
    zipName: chosen.name,
    zipBytes: chosen.size,
    bytesSent: result.bytesSent,
  };
};

/**
 * Orchestrates the offsite transfer: spawn, progress relay, abort, session
 * logging, and the running/stopping/run-error state transitions. Mirrors
 * `useArchiveRun`'s mechanics — the synchronous start latch, the
 * `runningRef` mutation, the `AbortController`, the best-effort
 * `logSession` — without sharing its type. See D12 of the offsite plan:
 * `useArchiveRun` bakes `entries`/`totalBytes` into both its options and its
 * runner signature, and a name-collision preview this flow has no
 * equivalent of; generalizing it would cost three more type parameters and
 * an optional resolver on a hook with two callers total. Writing this one
 * separately was the documented decision, not an oversight.
 *
 * Unlike `useArchiveRun`, there is no "preview" step to wait on — the
 * confirmation already happened on the previous screen — so the transfer
 * starts the moment this hook mounts. The same synchronous latch still
 * matters here: without it, a `retry()` fired twice (or a mount effect that
 * re-runs because one of its dependencies changed identity) could start two
 * overlapping transfers of the same file.
 */
export const useOffsiteRun = ({
  cwd,
  chosen,
  binPath,
  settings,
  runningRef,
  platform = process.platform,
  uploadArchive: uploadArchiveFn,
  onComplete,
}: UseOffsiteRunOptions): UseOffsiteRunResult => {
  const [state, setState] = useState<OffsiteRunState>({ kind: "running" });
  const controllerRef = useRef<AbortController | null>(null);
  const runningHandlesRef = useRef<RunningViewHandles | null>(null);
  // Synchronous latch, deliberately not state: two calls to `runUpload` in
  // the same tick (a re-firing mount effect, a double `retry()`) would both
  // pass a state-based guard before either write lands — see
  // `useArchiveRun.startArchive` for the same reasoning.
  const startedRef = useRef(false);

  const runUpload = useCallback(async (): Promise<void> => {
    if (startedRef.current) return;
    startedRef.current = true;

    const controller = new AbortController();
    controllerRef.current = controller;
    runningRef.current = true;
    setState({ kind: "running" });

    const startedAt = performance.now();
    const deps: UploadArchiveDeps = {
      spawn: nodeRcloneSpawn,
      remoteStat: (params) => remoteStat({ binPath }, params),
    };

    let result: UploadArchiveResult;
    try {
      const runner = uploadArchiveFn ?? defaultUploadArchive;
      result = await runner(deps, {
        rcloneBinPath: binPath,
        platform,
        settings,
        key: chosen.name,
        localPath: chosen.path,
        localBytes: chosen.size,
        signal: controller.signal,
        onProgress: (bytesTransferred) => {
          runningHandlesRef.current?.onProgress(bytesTransferred);
        },
      });
    } catch (err) {
      runningRef.current = false;
      controllerRef.current = null;
      setState({
        kind: "run-error",
        code: extractErrorCode(err),
        zipBytes: chosen.size,
      });
      return;
    }

    // Synchronous finalize — forces bar to 100 % before unmount.
    runningHandlesRef.current?.finalizeRender();

    const durationMs = performance.now() - startedAt;
    try {
      await logSession(
        buildOffsiteSessionEvent(
          buildSessionOutcome(result, chosen, settings),
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
      setState({
        kind: "run-error",
        code: result.code,
        zipBytes: chosen.size,
      });
      return;
    }

    if (result.kind === "aborted") {
      onComplete({ kind: "aborted" });
      return;
    }

    onComplete({
      kind: "ok",
      zipName: chosen.name,
      zipBytes: chosen.size,
      verified: result.verified,
      finishedAtMs: Date.now(),
      durationMs,
    });
    // Deliberately not exhaustive over every prop: `chosen`/`settings`
    // identity churning across renders must never restart an in-flight
    // transfer — `startedRef` is what makes that safe, not a stable
    // callback. Listed here anyway so a genuinely new run (a fresh
    // `chosen`/`cwd` after navigating back and picking a different archive)
    // rebuilds the closure it captures.
  }, [
    binPath,
    chosen,
    cwd,
    onComplete,
    platform,
    runningRef,
    settings,
    uploadArchiveFn,
  ]);

  useEffect(() => {
    void runUpload();
  }, [runUpload]);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      runningRef.current = false;
    };
  }, [runningRef]);

  const abort = (): void => {
    if (state.kind !== "running") return;
    setState({ kind: "stopping" });
    controllerRef.current?.abort();
  };

  const retry = (): void => {
    if (state.kind !== "run-error") return;
    startedRef.current = false;
    setState({ kind: "running" });
    void runUpload();
  };

  const registerRunningViewHandles = (handles: RunningViewHandles): void => {
    runningHandlesRef.current = handles;
  };

  return { state, abort, retry, registerRunningViewHandles };
};
