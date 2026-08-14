import { describe, expect, it } from "vitest";
import { shouldRenderNow, THROTTLE_MS } from "../renderThrottle.js";

describe("shouldRenderNow", () => {
  it("returns false when exactly THROTTLE_MS has elapsed (strict >)", () => {
    expect(shouldRenderNow(0, THROTTLE_MS)).toBe(false);
  });

  it("returns true when one ms more than THROTTLE_MS has elapsed", () => {
    expect(shouldRenderNow(0, THROTTLE_MS + 1)).toBe(true);
  });

  it("returns false when the delta is zero", () => {
    expect(shouldRenderNow(1_000, 1_000)).toBe(false);
  });

  it("returns false when the delta is negative", () => {
    expect(shouldRenderNow(1_000, 500)).toBe(false);
  });
});
