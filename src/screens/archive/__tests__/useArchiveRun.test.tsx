import { Text } from "ink";
import { render } from "ink-testing-library";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEvent } from "../../../types.js";
import {
  useArchiveRun,
  type ArchiveConfirmState,
  type ArchiveRunner,
  type ArchiveRunnerResult,
  type ArchiveRunOutcome,
  type BackupOkResult,
  type UseArchiveRunOptions,
} from "../useArchiveRun.js";

/**
 * Polls until `predicate` is true, or throws after `timeoutMs`.
 */
const waitUntil = async (
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitUntil: timed out");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
};

const sampleEntries = [
  { name: "a_001.wav", size: 4, mtime: new Date("2026-01-01T00:00:00Z") },
];
const sampleTotalBytes = 4;

const stubSessionEvent: SessionEvent = {
  schema_version: 5,
  ts: "2026-01-01T00:00:00.000Z",
  version: "test",
  cwd: "/tmp",
  action: "vigie-archive",
  result: {
    status: "ok",
    zip_name: "stub.zip",
    entry_count: 0,
    total_bytes: 0,
    zip_bytes: 0,
    duration_ms: 0,
    durable: true,
  },
};

const okResolveTargetName = () =>
  Promise.resolve({ name: "processed_20260101.zip", alreadyExists: false });

type HookControls = {
  state: ArchiveConfirmState;
  startArchive: () => Promise<void>;
  abort: () => void;
  retry: () => void;
};

// Module-level mutable box — reassigned on every render so callers always
// read the latest state by accessing `controlsBox.current`. See
// vigie-process's useVigieProcessRun.test.tsx for the same pattern and why
// a bare `let` doesn't narrow correctly here.
const controlsBox: { current: HookControls | null } = { current: null };

const TestComponent = (
  props: UseArchiveRunOptions<BackupOkResult>,
): React.JSX.Element => {
  const { state, startArchive, abort, retry } = useArchiveRun(props);
  controlsBox.current = { state, startArchive, abort, retry };
  return <Text>ok</Text>;
};

const getControls = (): HookControls => {
  const c = controlsBox.current;
  if (c === null) throw new Error("controls not set — component not rendered");
  return c;
};

/**
 * A stub that mirrors the real runner's abort contract: it never resolves
 * on its own, only once the run's `AbortSignal` fires — resolving with
 * `{ kind: "aborted" }`. Mirrors vigie-process's `makeAbortAwareStub`.
 */
const makeAbortAwareRunnerStub = (): {
  runner: ArchiveRunner<BackupOkResult>;
  getSignal: () => AbortSignal | undefined;
} => {
  const signalBox: { current: AbortSignal | undefined } = {
    current: undefined,
  };
  const runner: ArchiveRunner<BackupOkResult> = (opts) => {
    signalBox.current = opts.signal;
    return new Promise<ArchiveRunnerResult<BackupOkResult>>((resolve) => {
      const resolveAborted = (): void => {
        resolve({ kind: "aborted" });
      };
      if (opts.signal.aborted) {
        resolveAborted();
        return;
      }
      opts.signal.addEventListener("abort", resolveAborted, { once: true });
    });
  };
  return { runner, getSignal: () => signalBox.current };
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-test-archive-run-"));
  controlsBox.current = null;
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const renderHook = (
  runner: ArchiveRunner<BackupOkResult>,
  runningRef: { current: boolean },
  onComplete: (outcome: ArchiveRunOutcome<BackupOkResult>) => void,
) =>
  render(
    <TestComponent
      cwd={tmpDir}
      entries={sampleEntries}
      totalBytes={sampleTotalBytes}
      runningRef={runningRef}
      runner={runner}
      resolveTargetName={okResolveTargetName}
      buildSessionEvent={() => stubSessionEvent}
      onComplete={onComplete}
    />,
  );

describe("useArchiveRun — runningRef lifecycle", () => {
  it("is true synchronously once startArchive is called, and false again on success", async () => {
    const runningRef = { current: false };
    const onComplete = vi.fn();
    const okResult: ArchiveRunnerResult<BackupOkResult> = {
      kind: "backup-ok",
      zipPath: path.join(tmpDir, "processed_20260101.zip"),
      zipBytes: 4,
      entryCount: sampleEntries.length,
      durationMs: 1,
      durable: true,
    };
    const runner: ArchiveRunner<BackupOkResult> = () =>
      Promise.resolve(okResult);

    renderHook(runner, runningRef, onComplete);
    await waitUntil(() => getControls().state.kind === "preview");

    expect(runningRef.current).toBe(false);
    const runPromise = getControls().startArchive();
    // Set synchronously as the first statement in `startArchive`, before any
    // `await` — observable immediately, no polling needed.
    expect(runningRef.current).toBe(true);

    await runPromise;

    expect(runningRef.current).toBe(false);
    expect(onComplete).toHaveBeenCalledWith(okResult);
  });

  it("is false again after an abort, having passed through the cleaning state", async () => {
    const runningRef = { current: false };
    const onComplete = vi.fn();
    const { runner, getSignal } = makeAbortAwareRunnerStub();

    renderHook(runner, runningRef, onComplete);
    await waitUntil(() => getControls().state.kind === "preview");

    void getControls().startArchive();
    await waitUntil(() => getControls().state.kind === "running");
    expect(runningRef.current).toBe(true);

    getControls().abort();
    await waitUntil(() => getControls().state.kind === "cleaning");

    await waitUntil(() => onComplete.mock.calls.length > 0);

    expect(onComplete).toHaveBeenCalledWith({ kind: "aborted" });
    expect(runningRef.current).toBe(false);
    expect(getSignal()?.aborted).toBe(true);
  });

  it("abort() is a no-op outside of the running state", async () => {
    const runningRef = { current: false };
    const onComplete = vi.fn();
    const runner: ArchiveRunner<BackupOkResult> = () =>
      Promise.resolve({ kind: "aborted" });

    renderHook(runner, runningRef, onComplete);
    await waitUntil(() => getControls().state.kind === "preview");

    getControls().abort();

    expect(getControls().state.kind).toBe("preview");
  });
});

describe("useArchiveRun — defensive error handling", () => {
  it("goes to run-error without crashing when the runner rejects (thrown, not a Result)", async () => {
    const runningRef = { current: false };
    const onComplete = vi.fn();
    const runner: ArchiveRunner<BackupOkResult> = () => {
      throw new Error("boom, no .code");
    };

    renderHook(runner, runningRef, onComplete);
    await waitUntil(() => getControls().state.kind === "preview");

    void getControls().startArchive();
    await waitUntil(() => getControls().state.kind === "run-error");

    const state = getControls().state;
    if (state.kind !== "run-error") throw new Error("type narrowing");
    // extractErrorCode's fallback for an Error without a `.code` property.
    expect(state.code).toBe("UNKNOWN");
    expect(runningRef.current).toBe(false);
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe("useArchiveRun — session logging is best-effort", () => {
  // `useArchiveRun` has no `logFile` override hook (unlike `logSession`
  // itself, which accepts one only for its own unit tests) — a real write
  // attempt against `~/.chiro/sessions.jsonl` happens on every run here,
  // same as the pre-existing `useVigieProcessRun.test.tsx`. Per the task
  // brief, forcing that write to fail is out of scope (no DI, and mocking
  // `node:fs` is disallowed): this test only confirms the run's success
  // does not depend on it, via the real try/catch around `logSession` in
  // `useArchiveRun.ts`. The log-write-failure branch itself stays
  // unexercised — see the final report.
  it("completes successfully and reaches onComplete regardless of the real session-log write", async () => {
    const runningRef = { current: false };
    const onComplete = vi.fn();
    const okResult: ArchiveRunnerResult<BackupOkResult> = {
      kind: "backup-ok",
      zipPath: path.join(tmpDir, "processed_20260101.zip"),
      zipBytes: 4,
      entryCount: sampleEntries.length,
      durationMs: 1,
      durable: true,
    };
    const runner: ArchiveRunner<BackupOkResult> = () =>
      Promise.resolve(okResult);

    renderHook(runner, runningRef, onComplete);
    await waitUntil(() => getControls().state.kind === "preview");

    await getControls().startArchive();

    expect(onComplete).toHaveBeenCalledWith(okResult);
    expect(getControls().state.kind).not.toBe("run-error");
  });

  it("ignores a second startArchive fired in the same tick (Entrée auto-repeat)", async () => {
    // The state only flips to "running" several awaits into startArchive, so
    // a state-based guard lets two same-tick keypresses race two runs onto
    // the same tmp path AND the same final zip name — one of them then fails
    // and shows "Aucun fichier zip n'a été créé" while the other succeeded.
    const runningRef = { current: false };
    const onComplete = vi.fn();
    let starts = 0;
    const runner: ArchiveRunner<BackupOkResult> = async () => {
      starts++;
      await new Promise<void>((r) => setTimeout(r, 30));
      return {
        kind: "backup-ok",
        zipPath: path.join(tmpDir, "processed_20260101.zip"),
        zipBytes: 4,
        entryCount: sampleEntries.length,
        durationMs: 1,
        durable: true,
      };
    };

    renderHook(runner, runningRef, onComplete);
    await waitUntil(() => getControls().state.kind === "preview");

    const { startArchive } = getControls();
    await Promise.all([startArchive(), startArchive()]);

    expect(starts).toBe(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe("useArchiveRun — retry", () => {
  it("re-resolves the preview via resolveTargetName and returns to 'preview'", async () => {
    const runningRef = { current: false };
    const onComplete = vi.fn();
    let resolveCalls = 0;
    const resolveTargetName = () => {
      resolveCalls++;
      return Promise.resolve({
        name: "processed_20260101.zip",
        alreadyExists: false,
      });
    };
    const runner: ArchiveRunner<BackupOkResult> = () =>
      Promise.resolve({ kind: "error", code: "ENOSPC" });

    render(
      <TestComponent
        cwd={tmpDir}
        entries={sampleEntries}
        totalBytes={sampleTotalBytes}
        runningRef={runningRef}
        runner={runner}
        resolveTargetName={resolveTargetName}
        buildSessionEvent={() => stubSessionEvent}
        onComplete={onComplete}
      />,
    );
    await waitUntil(() => getControls().state.kind === "preview");
    expect(resolveCalls).toBe(1);

    void getControls().startArchive();
    await waitUntil(() => getControls().state.kind === "run-error");

    getControls().retry();
    await waitUntil(() => getControls().state.kind === "preview");

    expect(resolveCalls).toBe(2);
  });
});
