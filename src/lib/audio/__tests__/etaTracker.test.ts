import { describe, expect, it } from "vitest";
import {
  createETATracker,
  elapsedMs,
  estimateRemainingMs,
  markFileDone,
  SLIDING_WINDOW_SIZE,
} from "../etaTracker.js";

describe("etaTracker", () => {
  it("estimateRemainingMs returns null when bytesDone is 0", () => {
    const t = createETATracker(10000, 0);
    expect(estimateRemainingMs(t, 5000)).toBeNull();
  });

  it("estimateRemainingMs estimates from sliding window after one markFileDone", () => {
    // bytesTotal=10000, after marking 1000 bytes done over 1000ms,
    // throughput = 1 byte/ms → 9000 bytes remaining → 9000 ms
    const t = createETATracker(10000, 0);
    markFileDone(t, 1000, 1000);
    const remaining = estimateRemainingMs(t, 1000);
    expect(remaining).toBe(9000);
  });

  it("estimateRemainingMs drops the oldest sample once the window is full", () => {
    // One slow file (1 byte/ms), then a full window of fast ones
    // (10 bytes/ms). The slow sample must be evicted, so the estimate
    // reflects the fast rate only. Written against SLIDING_WINDOW_SIZE
    // rather than a hard-coded count, so retuning the window keeps this
    // test meaningful instead of merely re-baselining it.
    const totalBytes = 1_000_000;
    const t = createETATracker(totalBytes, 0);

    let now = 100;
    markFileDone(t, 100, now); // slow: 100 bytes over 100 ms — to be evicted
    for (let i = 0; i < SLIDING_WINDOW_SIZE; i++) {
      now += 10;
      markFileDone(t, 100, now); // fast: 100 bytes over 10 ms
    }

    const bytesDone = 100 * (SLIDING_WINDOW_SIZE + 1);
    const expected = (totalBytes - bytesDone) / 10; // 10 bytes/ms
    expect(estimateRemainingMs(t, now)).toBeCloseTo(expected, 0);
  });

  it("keeps the slow sample while the window still has room", () => {
    // Mirror of the test above: with fewer marks than the window holds,
    // nothing is evicted and the slow file must still drag the estimate up.
    const t = createETATracker(10_000, 0);
    markFileDone(t, 100, 100); // slow
    markFileDone(t, 100, 110); // fast
    // Blended rate: 200 bytes over 110 ms, well below the fast-only rate.
    const remaining = estimateRemainingMs(t, 110);
    if (remaining === null) throw new Error("expected an estimate");
    expect(remaining).toBeGreaterThan((10_000 - 200) / 10);
  });

  it("estimateRemainingMs depends on bytes, not file count", () => {
    // Three files with very different sizes, all processed quickly.
    // ETA should be byte-weighted, not count-based.
    const bytesTotal = 9000;
    const t = createETATracker(bytesTotal, 0);
    markFileDone(t, 10, 10);
    markFileDone(t, 100, 110);
    markFileDone(t, 1000, 1110);

    // Window: all 3 files
    // Total window: 1110 bytes over 1110ms → 1 byte/ms
    // bytesDone = 1110, bytesRemaining = 7890
    // estimate = 7890 ms
    const remaining = estimateRemainingMs(t, 1110);
    expect(remaining).toBeCloseTo(7890, 0);

    // Sanity: count-based (3 done out of 9 × elapsed=1110ms → remaining=2220ms)
    // would give 2220, which is very different from 7890.
    expect(remaining).not.toBeCloseTo(2220, 0);
  });

  it("elapsedMs grows monotonically as time advances", () => {
    const t = createETATracker(1000, 0);
    const e1 = elapsedMs(t, 100);
    const e2 = elapsedMs(t, 200);
    const e3 = elapsedMs(t, 300);
    expect(e1).toBe(100);
    expect(e2).toBe(200);
    expect(e3).toBe(300);
    expect(e1).toBeLessThan(e2);
    expect(e2).toBeLessThan(e3);
  });

  it("estimateRemainingMs returns null when window is empty", () => {
    const t = createETATracker(10000, 0);
    // bytesDone is 0 — no markFileDone called
    expect(estimateRemainingMs(t, 1000)).toBeNull();
  });

  it("estimateRemainingMs returns 0 when all bytes are done", () => {
    const t = createETATracker(1000, 0);
    markFileDone(t, 1000, 500);
    const remaining = estimateRemainingMs(t, 500);
    expect(remaining).toBe(0);
  });
});

describe("estimateRemainingMs — double-counted bytes", () => {
  it("never returns a negative estimate when bytesDone overshoots the total", () => {
    // Real path: the sox fast-path marks file 1 done, its spot-check then
    // fails, and the whole batch replays through the worker pool — which
    // marks file 1 done a second time.
    const t = createETATracker(300, 0);
    markFileDone(t, 200, 1_000);
    markFileDone(t, 200, 2_000);

    const remaining = estimateRemainingMs(t, 2_000);
    expect(remaining).not.toBeNull();
    expect(remaining ?? -1).toBeGreaterThanOrEqual(0);
  });
});
