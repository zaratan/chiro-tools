import { describe, expect, it } from "vitest";
import { columnWidth } from "../../../format/path.js";
import { buildStatsLine } from "../RunningView.js";

// formatShortDuration and buildRemainingLabel are unit-tested at their
// source in format/progress.test.ts — this file only covers the
// composition left behind in this screen.
describe("buildStatsLine — composition with adaptive masking", () => {
  it("drops the ETA segment for small batches", () => {
    expect(buildStatsLine(5_000, null, 3)).toBe("Temps écoulé 5 s");
    expect(buildStatsLine(5_000, 12_345, 3)).toBe("Temps écoulé 5 s");
  });

  it("renders the placeholder when ETA is not yet known on a nominal batch", () => {
    expect(buildStatsLine(5_000, null, 100)).toBe(
      "Temps écoulé 5 s • Calcul du temps restant…",
    );
  });

  it("renders the ETA when known on a nominal batch", () => {
    expect(buildStatsLine(90_000, 340_000, 100)).toBe(
      "Temps écoulé 1 min 30 s • Encore environ 5 min 40 s",
    );
  });

  it("stays inside the 66-column content width at its longest", () => {
    // Worst realistic case: both durations in hours. The stats line is
    // column-aligned inside the panel, so a wrap orphans its tail on the
    // left margin for the whole run — the screen she watches for 25 min.
    const longest = buildStatsLine(3_600_000 * 3, 3_600_000 * 12, 5_000);
    expect(columnWidth(longest)).toBeLessThanOrEqual(64); // 66 − 2 d'indentation
  });
});
