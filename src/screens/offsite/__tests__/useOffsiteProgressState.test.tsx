import { Text } from "ink";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import type { OffsiteProgressState } from "../useOffsiteProgressState.js";
import { useOffsiteProgressState } from "../useOffsiteProgressState.js";

type Controls = {
  state: OffsiteProgressState;
  onProgress: (bytesTransferred: number) => void;
  finalizeRender: () => void;
};

// Module-level mutable box, reassigned on every render — mirrors the same
// pattern in `screens/archive/__tests__/useArchiveRun.test.tsx`.
const controlsBox: { current: Controls | null } = { current: null };

const TestComponent = ({
  totalBytes,
  nowFn,
}: {
  totalBytes: number;
  nowFn: () => number;
}): React.JSX.Element => {
  const { state, onProgress, finalizeRender } = useOffsiteProgressState(
    totalBytes,
    nowFn,
  );
  controlsBox.current = { state, onProgress, finalizeRender };
  return <Text>ok</Text>;
};

const getControls = (): Controls => {
  const c = controlsBox.current;
  if (c === null) throw new Error("controls not set — component not rendered");
  return c;
};

/** A controllable clock: `now()` reads the box, tests advance it by hand. */
const makeClock = (start = 0): { now: () => number; box: { ms: number } } => {
  const box = { ms: start };
  return { now: () => box.ms, box };
};

/** State updates fired from outside an Ink input handler (a plain function
 * call here, not a keypress) still need a tick to flush into a re-render —
 * mirrors the `await new Promise((r) => setTimeout(r, 10))` used throughout
 * `screens/archive/__tests__/RunningView.test.tsx`. */
const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 10));

describe("useOffsiteProgressState — bytes and ETA", () => {
  it("never lets the shown bytes go backward on a retry-induced dip", async () => {
    controlsBox.current = null;
    const { now, box } = makeClock();
    render(<TestComponent totalBytes={1000} nowFn={now} />);

    getControls().onProgress(400);
    box.ms += 1000;
    getControls().onProgress(100); // rclone's own counter walked back
    await flush();

    expect(getControls().state.bytesTransferred).toBe(400);
  });

  it("finalizeRender forces bytesTransferred to totalBytes and clears stalled", async () => {
    controlsBox.current = null;
    const { now, box } = makeClock();
    render(<TestComponent totalBytes={1000} nowFn={now} />);

    getControls().onProgress(100);
    box.ms += 61_000;
    getControls().onProgress(100); // no delta — triggers a stall
    await flush();
    expect(getControls().state.stalled).toBe(true);

    getControls().finalizeRender();
    await flush();

    expect(getControls().state.bytesTransferred).toBe(1000);
    expect(getControls().state.stalled).toBe(false);
  });
});

describe("useOffsiteProgressState — stall detection (D3 of the offsite plan)", () => {
  it("stays un-stalled while bytes keep moving, even across many ticks", async () => {
    controlsBox.current = null;
    const { now, box } = makeClock();
    render(<TestComponent totalBytes={100_000} nowFn={now} />);

    for (let i = 1; i <= 10; i++) {
      box.ms += 1000;
      getControls().onProgress(i * 1000);
    }
    await flush();

    expect(getControls().state.stalled).toBe(false);
    expect(getControls().state.remainingMs).not.toBeNull();
  });

  it("flags stalled and withholds the ETA after 60s without a single new byte", async () => {
    controlsBox.current = null;
    const { now, box } = makeClock();
    render(<TestComponent totalBytes={100_000} nowFn={now} />);

    box.ms += 1000;
    getControls().onProgress(5000);
    await flush();
    expect(getControls().state.stalled).toBe(false);

    // Ticks keep arriving (rclone's --stats 1s never stops), but bytes
    // don't move — this is the "wifi qui tousse" scenario, not a crash.
    for (let i = 0; i < 65; i++) {
      box.ms += 1000;
      getControls().onProgress(5000);
    }
    await flush();

    expect(getControls().state.stalled).toBe(true);
    expect(getControls().state.remainingMs).toBeNull();
  });

  it("clears stalled the instant bytes resume", async () => {
    controlsBox.current = null;
    const { now, box } = makeClock();
    render(<TestComponent totalBytes={100_000} nowFn={now} />);

    getControls().onProgress(5000);
    for (let i = 0; i < 65; i++) {
      box.ms += 1000;
      getControls().onProgress(5000);
    }
    await flush();
    expect(getControls().state.stalled).toBe(true);

    box.ms += 1000;
    getControls().onProgress(6000);
    await flush();

    expect(getControls().state.stalled).toBe(false);
    expect(getControls().state.bytesTransferred).toBe(6000);
  });
});
