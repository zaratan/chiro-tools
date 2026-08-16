import { describe, expect, it } from "vitest";
import { shouldRenderNow, THROTTLE_MS } from "../renderThrottle.js";

describe("shouldRenderNow", () => {
  // Every assertion below pins an absolute millisecond value. Writing them in
  // terms of THROTTLE_MS instead — `shouldRenderNow(0, THROTTLE_MS)` — tests
  // the `>` operator and holds for *any* constant, including 0. The number is
  // the thing worth locking: it is a perception threshold, not an
  // implementation detail.
  it("throttles to ~10 Hz", () => {
    expect(THROTTLE_MS).toBe(100);
  });

  it("does not render again before 100 ms have elapsed", () => {
    expect(shouldRenderNow(0, 99)).toBe(false);
    expect(shouldRenderNow(0, 100)).toBe(false);
  });

  it("renders once past 100 ms", () => {
    expect(shouldRenderNow(0, 101)).toBe(true);
    expect(shouldRenderNow(1_000, 1_200)).toBe(true);
  });

  it("never renders on a zero or backwards delta", () => {
    expect(shouldRenderNow(500, 500)).toBe(false);
    expect(shouldRenderNow(500, 400)).toBe(false);
  });
});
