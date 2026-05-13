import { describe, expect, it } from "vitest";
import {
  createETATracker,
  elapsedMs,
  estimateRemainingMs,
  markFileDone,
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

  it("estimateRemainingMs uses sliding window throughput (last 5 files)", () => {
    // 6 files done: first one was slow (1 byte/ms), rest fast (10 bytes/ms).
    // Window holds last 5; oldest (slow) is dropped → estimate uses fast rate.
    const t = createETATracker(10000, 0);
    // File 0: 100 bytes over 100ms (slow: 1 byte/ms) — will be evicted
    markFileDone(t, 100, 100);
    // Files 1-5: each 100 bytes over 10ms (fast: 10 bytes/ms)
    markFileDone(t, 100, 110);
    markFileDone(t, 100, 120);
    markFileDone(t, 100, 130);
    markFileDone(t, 100, 140);
    markFileDone(t, 100, 150);

    // Window now contains files 1-5: each { bytes: 100, durationMs: 10 }
    // throughput = 500 bytes / 50ms = 10 bytes/ms
    // bytesDone = 600, bytesRemaining = 9400
    // estimate = 9400 / 10 = 940 ms
    const remaining = estimateRemainingMs(t, 150);
    expect(remaining).toBeCloseTo(940, 0);
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
