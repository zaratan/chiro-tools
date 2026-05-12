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

  it("estimateRemainingMs uses byte ratio after one markFileDone", () => {
    // bytesTotal=10000, after marking 1000 done at t=1000ms,
    // bytesRemaining=9000, ratio=9 → remaining = 1000 * 9 = 9000 ms
    const t = createETATracker(10000, 0);
    markFileDone(t, 1000);
    const remaining = estimateRemainingMs(t, 1000);
    expect(remaining).toBe(9000);
  });

  it("estimateRemainingMs depends on bytes, not file count", () => {
    // Three files with very different sizes: 10, 100, 1000 bytes.
    // If ETA were count-based (3 files done out of 9), the estimate would be
    // elapsed * 2. With byte-weighting (1110 done out of 9000), the ratio is
    // (9000-1110)/1110 ≈ 7.108, so remaining ≈ elapsed * 7.108.
    const bytesTotal = 9000;
    const t = createETATracker(bytesTotal, 0);
    markFileDone(t, 10);
    markFileDone(t, 100);
    markFileDone(t, 1000);

    const elapsed = 1000;
    const bytesDone = 10 + 100 + 1000;
    const bytesRemaining = bytesTotal - bytesDone;
    const expectedRemaining = elapsed * (bytesRemaining / bytesDone);

    const remaining = estimateRemainingMs(t, elapsed);
    expect(remaining).toBeCloseTo(expectedRemaining, 5);

    // Sanity: must NOT equal the count-based estimate
    const countBasedRemaining = elapsed * 2;
    expect(remaining).not.toBeCloseTo(countBasedRemaining, 0);
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
});
