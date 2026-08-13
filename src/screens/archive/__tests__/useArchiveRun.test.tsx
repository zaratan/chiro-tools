import { Text } from "ink";
import { render } from "ink-testing-library";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CreateZipArchiveOptions,
  CreateZipArchiveResult,
} from "../../../lib/archive/createZipArchive.js";
import type { ArchiveEntryStat } from "../../../lib/archive/planArchive.js";
import {
  useArchiveRun,
  type ArchiveConfirmState,
  type ArchiveRunOutcome,
  type CreateZipArchiveFn,
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

const sampleEntries: ArchiveEntryStat[] = [
  { name: "a_001.wav", size: 4, mtime: new Date("2026-01-01T00:00:00Z") },
];
const sampleTotalBytes = 4;

type HookControls = {
  state: ArchiveConfirmState;
  startArchive: () => Promise<void>;
  abort: () => void;
};

// Module-level mutable box — reassigned on every render so callers always
// read the latest state by accessing `controlsBox.current`. See
// vigie-process's useVigieProcessRun.test.tsx for the same pattern and why
// a bare `let` doesn't narrow correctly here.
const controlsBox: { current: HookControls | null } = { current: null };

const TestComponent = (props: UseArchiveRunOptions): React.JSX.Element => {
  const { state, startArchive, abort } = useArchiveRun(props);
  controlsBox.current = { state, startArchive, abort };
  return <Text>ok</Text>;
};

const getControls = (): HookControls => {
  const c = controlsBox.current;
  if (c === null) throw new Error("controls not set — component not rendered");
  return c;
};

/**
 * A stub that mirrors the real `createZipArchive` abort contract: it never
 * resolves on its own, only once the run's `AbortSignal` fires — resolving
 * with `{ kind: "aborted" }`. Mirrors vigie-process's `makeAbortAwareStub`.
 */
const makeAbortAwareZipStub = (): {
  fn: CreateZipArchiveFn;
  getSignal: () => AbortSignal | undefined;
} => {
  const signalBox: { current: AbortSignal | undefined } = {
    current: undefined,
  };
  const fn: CreateZipArchiveFn = (opts: CreateZipArchiveOptions) => {
    signalBox.current = opts.signal;
    return new Promise<CreateZipArchiveResult>((resolve) => {
      const resolveAborted = (): void => {
        resolve({ kind: "aborted" });
      };
      if (opts.signal?.aborted === true) {
        resolveAborted();
        return;
      }
      opts.signal?.addEventListener("abort", resolveAborted, { once: true });
    });
  };
  return { fn, getSignal: () => signalBox.current };
};

let tmpDir: string;
let processedDir: string;
let archivedDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-test-archive-run-"));
  processedDir = path.join(tmpDir, "processed");
  archivedDir = path.join(tmpDir, "archived");
  controlsBox.current = null;
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const renderHook = (
  createZipArchive: CreateZipArchiveFn,
  runningRef: { current: boolean },
  onComplete: (outcome: ArchiveRunOutcome) => void,
) =>
  render(
    <TestComponent
      cwd={tmpDir}
      processedDir={processedDir}
      archivedDir={archivedDir}
      entries={sampleEntries}
      totalBytes={sampleTotalBytes}
      runningRef={runningRef}
      createZipArchive={createZipArchive}
      onComplete={onComplete}
    />,
  );

describe("useArchiveRun — runningRef lifecycle", () => {
  it("is true synchronously once startArchive is called, and false again on success", async () => {
    const runningRef = { current: false };
    const onComplete = vi.fn();
    const okResult: CreateZipArchiveResult = {
      kind: "ok",
      zipPath: path.join(archivedDir, "processed_202601010000.zip"),
      zipBytes: 4,
      entryCount: sampleEntries.length,
      durationMs: 1,
    };
    const fn: CreateZipArchiveFn = () => Promise.resolve(okResult);

    renderHook(fn, runningRef, onComplete);
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

  it("is false again after a setup (mkdir) error", async () => {
    const runningRef = { current: false };
    const onComplete = vi.fn();
    // Occupies the 'archived' path with a plain file, so
    // `mkdir(archivedDir, { recursive: true })` fails with EEXIST instead of
    // creating the directory.
    await writeFile(archivedDir, "not a directory");
    const fn: CreateZipArchiveFn = () =>
      Promise.resolve({
        kind: "ok",
        zipPath: "unexpected",
        zipBytes: 0,
        entryCount: 0,
        durationMs: 0,
      });

    renderHook(fn, runningRef, onComplete);
    await waitUntil(() => getControls().state.kind === "preview");

    // Don't await `startArchive()` and read the box immediately after: the
    // hook's `setState` only lands in `controlsBox` once React re-renders
    // `TestComponent`, which can trail the promise's own resolution by a
    // tick. Poll for the state transition instead.
    void getControls().startArchive();
    await waitUntil(() => getControls().state.kind === "run-error");

    const state = getControls().state;
    if (state.kind !== "run-error") throw new Error("type narrowing");
    expect(state.code).toMatch(/^mkdir:/);
    expect(runningRef.current).toBe(false);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("is false again after an abort", async () => {
    const runningRef = { current: false };
    const onComplete = vi.fn();
    const { fn, getSignal } = makeAbortAwareZipStub();

    renderHook(fn, runningRef, onComplete);
    await waitUntil(() => getControls().state.kind === "preview");

    void getControls().startArchive();
    await waitUntil(() => getControls().state.kind === "running");
    expect(runningRef.current).toBe(true);

    getControls().abort();

    await waitUntil(() => onComplete.mock.calls.length > 0);

    expect(onComplete).toHaveBeenCalledWith({ kind: "aborted" });
    expect(runningRef.current).toBe(false);
    expect(getSignal()?.aborted).toBe(true);
  });
});

describe("useArchiveRun — defensive error handling", () => {
  it("goes to run-error without crashing when createZipArchive rejects (thrown, not a Result)", async () => {
    const runningRef = { current: false };
    const onComplete = vi.fn();
    const fn: CreateZipArchiveFn = () => {
      throw new Error("boom, no .code");
    };

    renderHook(fn, runningRef, onComplete);
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
    const okResult: CreateZipArchiveResult = {
      kind: "ok",
      zipPath: path.join(archivedDir, "processed_202601010000.zip"),
      zipBytes: 4,
      entryCount: sampleEntries.length,
      durationMs: 1,
    };
    const fn: CreateZipArchiveFn = () => Promise.resolve(okResult);

    renderHook(fn, runningRef, onComplete);
    await waitUntil(() => getControls().state.kind === "preview");

    await getControls().startArchive();

    expect(onComplete).toHaveBeenCalledWith(okResult);
    expect(getControls().state.kind).not.toBe("run-error");
  });
});
