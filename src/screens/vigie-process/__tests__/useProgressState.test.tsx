import { render } from "ink-testing-library";
import { Text } from "ink";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProgressEvent } from "../../../types.js";
import { useProgressState, type ProgressState } from "../useProgressState.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Drain React's microtask queue so setState flushes into the rendered tree. */
const waitForFrame = async (): Promise<void> => {
  await new Promise<void>((r) => setImmediate(r));
  await new Promise<void>((r) => setImmediate(r));
};

type HookControls = {
  onProgress: (event: ProgressEvent) => void;
  finalizeRender: () => void;
  state: ProgressState;
};

// Module-level mutable box — reassigned on every render so callers always
// read the latest state by accessing `controlsBox.current.state`.
const controlsBox: { current: HookControls | null } = { current: null };

/** Wrapper component that exposes the hook result via the module-level box. */
const TestComponent = ({
  totalFiles,
  totalChunksEstimate,
  totalBytes,
  nowFn,
}: {
  totalFiles: number;
  totalChunksEstimate: number;
  totalBytes: number;
  nowFn?: () => number;
}): React.JSX.Element => {
  const { state, onProgress, finalizeRender } = useProgressState(
    totalFiles,
    totalChunksEstimate,
    totalBytes,
    nowFn,
  );

  controlsBox.current = { onProgress, finalizeRender, state };

  // Render a sentinel so ink-testing-library has something to output.
  return <Text>ok</Text>;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useProgressState", () => {
  beforeEach(() => {
    controlsBox.current = null;
  });

  afterEach(() => {
    controlsBox.current = null;
  });

  const getControls = (): HookControls => {
    const c = controlsBox.current;
    if (c === null)
      throw new Error("controls not set — component not rendered");
    return c;
  };

  // -------------------------------------------------------------------------
  // Test 1: remainingMs === null before first file-done
  // -------------------------------------------------------------------------

  it("remainingMs is null before first file-done, currentFileName and chunksWritten update", async () => {
    let fakeNow = 0;
    render(
      <TestComponent
        totalFiles={2}
        totalChunksEstimate={10}
        totalBytes={10000}
        nowFn={() => fakeNow}
      />,
    );

    fakeNow = 100;
    getControls().onProgress({
      kind: "file-start",
      fileIndex: 0,
      fileName: "a.wav",
      fileSizeBytes: 1000,
      totalFiles: 2,
    });
    await waitForFrame();

    // Advance clock past the 100 ms throttle so chunk-written triggers setState
    fakeNow = 300;
    getControls().onProgress({
      kind: "chunk-written",
      fileIndex: 0,
      chunkIndex: 0,
    });
    await waitForFrame();

    const { state } = getControls();
    expect(state.remainingMs).toBeNull();
    expect(state.currentFileName).toBe("a.wav");
    expect(state.chunksWritten).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 2: remainingMs is a number after first file-done
  // -------------------------------------------------------------------------

  it("remainingMs becomes a number after first file-done", async () => {
    let fakeNow = 0;
    render(
      <TestComponent
        totalFiles={2}
        totalChunksEstimate={10}
        totalBytes={10000}
        nowFn={() => fakeNow}
      />,
    );

    fakeNow = 100;
    getControls().onProgress({
      kind: "file-start",
      fileIndex: 0,
      fileName: "a.wav",
      fileSizeBytes: 1000,
      totalFiles: 2,
    });
    await waitForFrame();

    fakeNow = 1000;
    getControls().onProgress({
      kind: "file-done",
      fileIndex: 0,
      chunkCount: 5,
      fileSizeBytes: 1000,
    });
    await waitForFrame();

    const { state } = getControls();
    expect(typeof state.remainingMs).toBe("number");
    expect(state.remainingMs).toBeGreaterThanOrEqual(0);
  });

  // -------------------------------------------------------------------------
  // Test 3: finalizeRender flushes to 100 %
  // -------------------------------------------------------------------------

  it("finalizeRender sets chunksWritten to totalChunksEstimate", async () => {
    let fakeNow = 0;
    render(
      <TestComponent
        totalFiles={2}
        totalChunksEstimate={10}
        totalBytes={10000}
        nowFn={() => fakeNow}
      />,
    );

    // Write a few chunks inside the throttle window — no setState triggered
    fakeNow = 50;
    getControls().onProgress({
      kind: "chunk-written",
      fileIndex: 0,
      chunkIndex: 0,
    });
    fakeNow = 60;
    getControls().onProgress({
      kind: "chunk-written",
      fileIndex: 0,
      chunkIndex: 1,
    });
    fakeNow = 70;
    getControls().onProgress({
      kind: "chunk-written",
      fileIndex: 0,
      chunkIndex: 2,
    });
    await waitForFrame();

    getControls().finalizeRender();
    await waitForFrame();

    expect(getControls().state.chunksWritten).toBe(10); // totalChunksEstimate
  });

  // -------------------------------------------------------------------------
  // Test 4: throttle does not drop the final frame via finalizeRender
  // -------------------------------------------------------------------------

  it("finalizeRender guarantees final value even after 100 throttled chunk-written events", async () => {
    const fakeNow = 0;
    render(
      <TestComponent
        totalFiles={1}
        totalChunksEstimate={100}
        totalBytes={50000}
        nowFn={() => fakeNow}
      />,
    );

    // Fire 100 chunk-written events all within the same 1 ms window
    // (way below the 100 ms throttle). No setState is triggered.
    for (let i = 0; i < 100; i++) {
      getControls().onProgress({
        kind: "chunk-written",
        fileIndex: 0,
        chunkIndex: i,
      });
    }
    await waitForFrame();

    getControls().finalizeRender();
    await waitForFrame();

    // finalizeRender overrides to totalChunksEstimate (100)
    expect(getControls().state.chunksWritten).toBe(100);
  });

  // -------------------------------------------------------------------------
  // Test 5: throttle drops intermediate chunk-written, but file-start always renders
  // -------------------------------------------------------------------------

  it("file-start always triggers a render even when inside the throttle window", async () => {
    let fakeNow = 0;
    render(
      <TestComponent
        totalFiles={2}
        totalChunksEstimate={10}
        totalBytes={10000}
        nowFn={() => fakeNow}
      />,
    );

    // chunk-written at t=0: now - lastRenderAt = 0 - 0 = 0, NOT > 100ms, no setState
    fakeNow = 0;
    getControls().onProgress({
      kind: "chunk-written",
      fileIndex: 0,
      chunkIndex: 0,
    });
    await waitForFrame();

    expect(getControls().state.currentFileName).toBeNull();

    // Second chunk-written at t=50 — still inside throttle window
    fakeNow = 50;
    getControls().onProgress({
      kind: "chunk-written",
      fileIndex: 0,
      chunkIndex: 1,
    });
    await waitForFrame();

    expect(getControls().state.currentFileName).toBeNull();

    // file-start for the next file — MUST always setState regardless of throttle
    fakeNow = 50;
    getControls().onProgress({
      kind: "file-start",
      fileIndex: 1,
      fileName: "b.wav",
      fileSizeBytes: 2000,
      totalFiles: 2,
    });
    await waitForFrame();

    expect(getControls().state.currentFileName).toBe("b.wav");
  });
});
