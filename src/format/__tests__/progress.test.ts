import { describe, expect, it } from "vitest";
import {
  buildRemainingLabel,
  formatShortDuration,
  renderBar,
} from "../progress.js";

describe("renderBar", () => {
  it("renders an empty bar at 0%", () => {
    expect(renderBar(0)).toBe("░".repeat(40));
  });

  it("renders a full bar at 100%", () => {
    expect(renderBar(100)).toBe("█".repeat(40));
  });

  it("renders a proportional split at intermediate percentages", () => {
    expect(renderBar(50)).toBe("█".repeat(20) + "░".repeat(20));
    expect(renderBar(25)).toBe("█".repeat(10) + "░".repeat(30));
  });
});

describe("formatShortDuration", () => {
  it("formats sub-minute values in seconds", () => {
    expect(formatShortDuration(0)).toBe("0 s");
    expect(formatShortDuration(999)).toBe("1 s");
    expect(formatShortDuration(5_000)).toBe("5 s");
    expect(formatShortDuration(42_400)).toBe("42 s");
    expect(formatShortDuration(59_499)).toBe("59 s");
  });

  it("crosses the 60 s boundary cleanly", () => {
    // 59 500 ms rounds to 60 s, which must render as `1 min`, not `60 s`.
    expect(formatShortDuration(59_500)).toBe("1 min");
    expect(formatShortDuration(60_000)).toBe("1 min");
  });

  it("formats minute+seconds with zero-padded seconds", () => {
    expect(formatShortDuration(65_000)).toBe("1 min 05 s");
    expect(formatShortDuration(90_000)).toBe("1 min 30 s");
    expect(formatShortDuration(125_000)).toBe("2 min 05 s");
  });

  it("formats hour+minutes with zero-padded minutes", () => {
    expect(formatShortDuration(3_600_000)).toBe("1 h 00 min");
    expect(formatShortDuration(5_400_000)).toBe("1 h 30 min");
    expect(formatShortDuration(9_000_000)).toBe("2 h 30 min");
  });
});

describe("buildRemainingLabel — adaptive masking", () => {
  it("returns null when itemsTotal < 5 (whole segment hidden)", () => {
    expect(buildRemainingLabel(null, 1)).toBeNull();
    expect(buildRemainingLabel(60_000, 4)).toBeNull();
  });

  it("returns the placeholder when remainingMs is null and batch is large enough", () => {
    expect(buildRemainingLabel(null, 5)).toBe("Calcul du temps restant…");
    expect(buildRemainingLabel(null, 100)).toBe("Calcul du temps restant…");
  });

  it("returns the formatted ETA when known", () => {
    expect(buildRemainingLabel(60_000, 5)).toBe("Encore environ 1 min");
    expect(buildRemainingLabel(340_000, 100)).toBe("Encore environ 5 min 40 s");
  });
});
