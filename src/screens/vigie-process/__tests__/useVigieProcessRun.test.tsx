import { render } from "ink-testing-library";
import { Text } from "ink";
import { describe, expect, it } from "vitest";
import type { ProcessResult } from "../../../lib/audio/processWavFiles.js";
import type { ProcessInput, ProcessOutcome } from "../../../types.js";
import type { ProcessWavFilesFn } from "../useVigieProcessRun.js";
import {
  useVigieProcessRun,
  type ConfirmState,
  type UseVigieProcessRunOptions,
} from "../useVigieProcessRun.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const interruptedOutcome: ProcessOutcome = {
  processed: [],
  errored: [],
  skippedTooLarge: [],
  skippedAlreadyChunked: [],
  interrupted: true,
  durationMs: 0,
};

/**
 * A stub that mirrors the real `processWavFiles` abort contract: it never
 * resolves on its own, only once the run's `AbortSignal` fires — resolving
 * with `interrupted: true`, the way a genuinely aborted split does. Also
 * exposes the signal it was called with, so a test can assert on it after
 * the component unmounts.
 */
const makeAbortAwareStub = (): {
  fn: ProcessWavFilesFn;
  getSignal: () => AbortSignal | undefined;
} => {
  let capturedSignal: AbortSignal | undefined;
  const fn: ProcessWavFilesFn = (_files, _dir, _input, options) => {
    capturedSignal = options?.signal;
    return new Promise((resolve) => {
      const resolveInterrupted = (): void => {
        resolve({
          ...interruptedOutcome,
          engine: "wavefile",
          engine_fallback_count: 0,
          metadata: "off",
        });
      };
      if (options?.signal?.aborted) {
        resolveInterrupted();
        return;
      }
      options?.signal?.addEventListener("abort", resolveInterrupted, {
        once: true,
      });
    });
  };
  return { fn, getSignal: () => capturedSignal };
};

type HookControls = {
  state: ConfirmState;
  startProcess: () => Promise<void>;
  abort: () => void;
};

// Module-level mutable box — reassigned on every render so callers always
// read the latest state by accessing `controlsBox.current`.
const controlsBox: { current: HookControls | null } = { current: null };

const TestComponent = (props: UseVigieProcessRunOptions): React.JSX.Element => {
  const { state, startProcess, abort } = useVigieProcessRun(props);
  controlsBox.current = { state, startProcess, abort };
  return <Text>ok</Text>;
};

const getControls = (): HookControls => {
  const c = controlsBox.current;
  if (c === null) throw new Error("controls not set — component not rendered");
  return c;
};

const input: ProcessInput = { mode: "preserve" };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useVigieProcessRun", () => {
  it("aborting an in-flight run resolves with interrupted outcome and clears runningRef", async () => {
    controlsBox.current = null;
    const runningRef = { current: false };
    const { fn: processWavFiles } = makeAbortAwareStub();
    // Object box, not a bare `let`: a plain `let` reassigned only from
    // inside the JSX callback below stays narrowed to its `null` initializer
    // for the rest of this function's control flow (TS's CFA is
    // intra-procedural — it does not see the callback's assignment) —
    // exactly the pattern `controlsBox` below avoids for the same reason.
    const outcomeBox: { current: ProcessResult | null } = { current: null };

    render(
      <TestComponent
        cwd="/tmp/chiro-test-does-not-exist"
        input={input}
        wavFiles={["a.wav"]}
        runningRef={runningRef}
        processWavFiles={processWavFiles}
        onComplete={(outcome) => {
          outcomeBox.current = outcome;
        }}
      />,
    );

    await waitUntil(() => getControls().state.kind === "preview");

    void getControls().startProcess();
    await waitUntil(() => getControls().state.kind === "running");
    expect(runningRef.current).toBe(true);

    getControls().abort();

    await waitUntil(() => outcomeBox.current !== null);

    expect(outcomeBox.current?.interrupted).toBe(true);
    expect(runningRef.current).toBe(false);
  });

  it("unmounting during a run aborts the signal passed to processWavFiles", async () => {
    controlsBox.current = null;
    const runningRef = { current: false };
    const { fn: processWavFiles, getSignal } = makeAbortAwareStub();

    const { unmount } = render(
      <TestComponent
        cwd="/tmp/chiro-test-does-not-exist"
        input={input}
        wavFiles={["a.wav"]}
        runningRef={runningRef}
        processWavFiles={processWavFiles}
        onComplete={() => undefined}
      />,
    );

    await waitUntil(() => getControls().state.kind === "preview");

    void getControls().startProcess();
    await waitUntil(() => getControls().state.kind === "running");

    const signal = getSignal();
    expect(signal).toBeDefined();
    expect(signal?.aborted).toBe(false);

    unmount();

    expect(signal?.aborted).toBe(true);
  });
});
