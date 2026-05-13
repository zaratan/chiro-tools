import { describe, expect, it } from "vitest";
import { formatDuration } from "../duration.js";

describe("formatDuration", () => {
  it("renders sub-minute durations in seconds", () => {
    expect(formatDuration(0)).toBe("0 secondes");
    expect(formatDuration(1)).toBe("1 secondes");
    expect(formatDuration(45)).toBe("45 secondes");
    expect(formatDuration(59.4)).toBe("59 secondes");
  });

  it("renders sub-hour durations in minutes with singular/plural", () => {
    expect(formatDuration(60)).toBe("1 minute");
    expect(formatDuration(90)).toBe("2 minutes");
    expect(formatDuration(630)).toBe("11 minutes");
    expect(formatDuration(60 * 59)).toBe("59 minutes");
  });

  it("renders durations ≥ 1h as h MM (60-minute threshold rounds up to 1 h 00)", () => {
    expect(formatDuration(3599)).toBe("1 h 00");
    expect(formatDuration(3600)).toBe("1 h 00");
    expect(formatDuration(3600 + 60 * 5)).toBe("1 h 05");
    expect(formatDuration(3600 * 2 + 60 * 35)).toBe("2 h 35");
  });
});
