import { describe, expect, it } from "vitest";
import { buildStatsLine } from "../RunningView.js";

// formatShortDuration and buildRemainingLabel are unit-tested at their
// source in format/progress.test.ts — this file only covers the
// composition left behind in this screen.
describe("buildStatsLine — composition with adaptive masking", () => {
  it("drops the ETA segment for small batches", () => {
    expect(buildStatsLine(120, 5_000, null, 3)).toBe(
      "120 fichiers • Temps écoulé 5 s",
    );
    expect(buildStatsLine(120, 5_000, 12_345, 3)).toBe(
      "120 fichiers • Temps écoulé 5 s",
    );
  });

  it("renders the placeholder when ETA is not yet known on a nominal batch", () => {
    expect(buildStatsLine(3, 5_000, null, 100)).toBe(
      "3 fichiers • Temps écoulé 5 s • Calcul du temps restant…",
    );
  });

  it("renders the ETA when known on a nominal batch", () => {
    expect(buildStatsLine(120, 90_000, 340_000, 100)).toBe(
      "120 fichiers • Temps écoulé 1 min 30 s • Encore environ 5 min 40 s",
    );
  });
});
