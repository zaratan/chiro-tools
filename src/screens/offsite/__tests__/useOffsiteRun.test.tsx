import { Text } from "ink";
import { render } from "ink-testing-library";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChosenArchive } from "../../../lib/offsite/pickArchiveToUpload.js";
import type { OffsiteSettings } from "../../../lib/offsite/settings.js";
import type { UploadArchiveResult } from "../../../lib/offsite/uploadArchive.js";
import {
  useOffsiteRun,
  type OffsiteRunOutcome,
  type OffsiteRunState,
  type UploadArchiveFn,
  type UseOffsiteRunOptions,
} from "../useOffsiteRun.js";

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

const settings: OffsiteSettings = {
  remote: "chiro-remote",
  bucket: "chiro-bucket",
  prefix: "vigie",
};

type HookControls = {
  state: OffsiteRunState;
  abort: () => void;
  retry: () => void;
};

const controlsBox: { current: HookControls | null } = { current: null };

const TestComponent = (props: UseOffsiteRunOptions): React.JSX.Element => {
  const { state, abort, retry } = useOffsiteRun(props);
  controlsBox.current = { state, abort, retry };
  return <Text>ok</Text>;
};

const getControls = (): HookControls => {
  const c = controlsBox.current;
  if (c === null) throw new Error("controls not set — component not rendered");
  return c;
};

/**
 * A stub that mirrors `uploadArchive`'s real abort contract: it never
 * resolves on its own, only once the run's `AbortSignal` fires — resolving
 * with `{ kind: "aborted", bytesSent }`. Mirrors archive's
 * `makeAbortAwareRunnerStub`.
 */
const makeAbortAwareUploadStub = (): {
  uploadArchive: UploadArchiveFn;
  getSignal: () => AbortSignal | undefined;
} => {
  const signalBox: { current: AbortSignal | undefined } = {
    current: undefined,
  };
  const uploadArchive: UploadArchiveFn = (_deps, options) => {
    signalBox.current = options.signal;
    return new Promise<UploadArchiveResult>((resolve) => {
      const resolveAborted = (): void => {
        resolve({ kind: "aborted", bytesSent: 0 });
      };
      if (options.signal?.aborted === true) {
        resolveAborted();
        return;
      }
      options.signal?.addEventListener("abort", resolveAborted, {
        once: true,
      });
    });
  };
  return { uploadArchive, getSignal: () => signalBox.current };
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-test-offsite-run-"));
  controlsBox.current = null;
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const makeChosen = (): ChosenArchive => ({
  name: "Car340581-2026-Pass1-A1_20260814.zip",
  path: path.join(tmpDir, "Car340581-2026-Pass1-A1_20260814.zip"),
  size: 4,
  mtimeMs: 0,
});

const renderHook = (
  uploadArchive: UploadArchiveFn,
  runningRef: { current: boolean },
  onComplete: (outcome: OffsiteRunOutcome) => void,
  chosen: ChosenArchive = makeChosen(),
) =>
  render(
    <TestComponent
      cwd={tmpDir}
      chosen={chosen}
      binPath="rclone"
      settings={settings}
      runningRef={runningRef}
      uploadArchive={uploadArchive}
      onComplete={onComplete}
    />,
  );

describe("useOffsiteRun — starts automatically on mount", () => {
  it("is 'running' immediately, then 'ok' reaches onComplete and clears runningRef", async () => {
    const runningRef = { current: false };
    const onComplete = vi.fn();
    const okResult: UploadArchiveResult = {
      kind: "ok",
      bytesSent: 4,
      attempts: 1,
      verified: "size-match",
    };
    const uploadArchive: UploadArchiveFn = () => Promise.resolve(okResult);

    renderHook(uploadArchive, runningRef, onComplete);

    expect(getControls().state.kind).toBe("running");
    expect(runningRef.current).toBe(true);

    await waitUntil(() => onComplete.mock.calls.length > 0);

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "ok", verified: "size-match" }),
    );
    expect(runningRef.current).toBe(false);
  });

  it("calls uploadArchive exactly once even if the mount effect fires twice", async () => {
    const runningRef = { current: false };
    const onComplete = vi.fn();
    let calls = 0;
    const uploadArchive: UploadArchiveFn = async () => {
      calls++;
      await new Promise<void>((r) => setTimeout(r, 20));
      return { kind: "ok", bytesSent: 4, attempts: 1, verified: "size-match" };
    };

    const chosen = makeChosen();
    const { rerender } = render(
      <TestComponent
        cwd={tmpDir}
        chosen={chosen}
        binPath="rclone"
        settings={settings}
        runningRef={runningRef}
        uploadArchive={uploadArchive}
        onComplete={onComplete}
      />,
    );
    // Re-render with a structurally-identical but new `chosen` object — this
    // changes `runUpload`'s useCallback identity and re-fires the mount
    // effect, which is exactly the case the synchronous `startedRef` latch
    // guards against.
    rerender(
      <TestComponent
        cwd={tmpDir}
        chosen={{ ...chosen }}
        binPath="rclone"
        settings={settings}
        runningRef={runningRef}
        uploadArchive={uploadArchive}
        onComplete={onComplete}
      />,
    );

    await waitUntil(() => onComplete.mock.calls.length > 0);
    expect(calls).toBe(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe("useOffsiteRun — abort", () => {
  it("goes running -> stopping -> onComplete(aborted), and a second abort() is a no-op", async () => {
    const runningRef = { current: false };
    const onComplete = vi.fn();
    const { uploadArchive, getSignal } = makeAbortAwareUploadStub();

    renderHook(uploadArchive, runningRef, onComplete);
    await waitUntil(() => getSignal() !== undefined);

    getControls().abort();
    await waitUntil(() => getControls().state.kind === "stopping");

    // Harmless — must not crash, must not double-fire onComplete. Read
    // through `getControls()` again first so this second call closes over
    // the post-re-render "stopping" state, not a stale "running" one.
    getControls().abort();
    expect(getControls().state.kind).toBe("stopping");

    await waitUntil(() => onComplete.mock.calls.length > 0);

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith({ kind: "aborted" });
    expect(runningRef.current).toBe(false);
    expect(getSignal()?.aborted).toBe(true);
  });

  it("abort() is a no-op before the run reaches 'running' is irrelevant — it always starts 'running'", () => {
    // There is no "preview" state here (unlike useArchiveRun): the hook
    // starts "running" the instant it mounts, so this documents that
    // abort() has nothing to no-op against except "stopping"/"run-error".
    const runningRef = { current: false };
    const onComplete = vi.fn();
    const uploadArchive: UploadArchiveFn = () => new Promise(() => undefined); // never resolves within this test

    renderHook(uploadArchive, runningRef, onComplete);
    expect(getControls().state.kind).toBe("running");
  });
});

describe("useOffsiteRun — run-error and retry", () => {
  it("goes to run-error on a non-zero-exit result, carrying the code and zipBytes", async () => {
    const runningRef = { current: false };
    const onComplete = vi.fn();
    const uploadArchive: UploadArchiveFn = () =>
      Promise.resolve({
        kind: "error",
        code: "transient",
        bytesSent: 0,
        fatalError: false,
      });

    const chosen = makeChosen();
    renderHook(uploadArchive, runningRef, onComplete, chosen);

    await waitUntil(() => getControls().state.kind === "run-error");
    const state = getControls().state;
    if (state.kind !== "run-error") throw new Error("type narrowing");
    expect(state.code).toBe("transient");
    expect(state.zipBytes).toBe(chosen.size);
    expect(runningRef.current).toBe(false);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("retry() restarts the transfer from a fresh AbortController", async () => {
    const runningRef = { current: false };
    const onComplete = vi.fn();
    let calls = 0;
    const uploadArchive: UploadArchiveFn = () => {
      calls++;
      if (calls === 1) {
        return Promise.resolve({
          kind: "error",
          code: "transient",
          bytesSent: 0,
          fatalError: false,
        });
      }
      return Promise.resolve({
        kind: "ok",
        bytesSent: 4,
        attempts: 1,
        verified: "size-match",
      });
    };

    renderHook(uploadArchive, runningRef, onComplete);
    await waitUntil(() => getControls().state.kind === "run-error");

    getControls().retry();
    await waitUntil(() => onComplete.mock.calls.length > 0);
    expect(calls).toBe(2);
    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "ok" }),
    );
  });

  it("goes to run-error without crashing when uploadArchive rejects (thrown, not a Result)", async () => {
    const runningRef = { current: false };
    const onComplete = vi.fn();
    const uploadArchive: UploadArchiveFn = () => {
      throw new Error("boom, no .code");
    };

    renderHook(uploadArchive, runningRef, onComplete);
    await waitUntil(() => getControls().state.kind === "run-error");

    const state = getControls().state;
    if (state.kind !== "run-error") throw new Error("type narrowing");
    expect(state.code).toBe("UNKNOWN");
    expect(runningRef.current).toBe(false);
    expect(onComplete).not.toHaveBeenCalled();
  });
});

describe("useOffsiteRun — session logging is best-effort", () => {
  // Same rationale and scope as `useArchiveRun.test.tsx`'s equivalent
  // describe block: no `logFile` override on this hook, so a real write
  // against `~/.chiro/sessions.jsonl` happens on every run here. This only
  // confirms the run's success does not depend on that write succeeding.
  it("completes successfully and reaches onComplete regardless of the real session-log write", async () => {
    const runningRef = { current: false };
    const onComplete = vi.fn();
    const uploadArchive: UploadArchiveFn = () =>
      Promise.resolve({
        kind: "ok",
        bytesSent: 4,
        attempts: 1,
        verified: "unavailable",
      });

    renderHook(uploadArchive, runningRef, onComplete);
    await waitUntil(() => onComplete.mock.calls.length > 0);

    expect(onComplete).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "ok", verified: "unavailable" }),
    );
  });
});
