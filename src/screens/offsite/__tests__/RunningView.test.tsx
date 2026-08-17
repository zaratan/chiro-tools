import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import type { ChosenArchive } from "../../../lib/offsite/pickArchiveToUpload.js";
import {
  buildReassuranceLines,
  buildStatsLine,
  RunningView,
  type RunningViewHandles,
} from "../RunningView.js";

const chosen: ChosenArchive = {
  name: "Car340581-2026-Pass1-A1_20260814.zip",
  path: "/tmp/chiro-demo/archived/Car340581-2026-Pass1-A1_20260814.zip",
  size: 14_200_000_000,
  mtimeMs: 0,
};

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 10));

describe("buildStatsLine", () => {
  it("shows the elapsed/remaining pair mot pour mot, like the other flows", () => {
    expect(buildStatsLine(90_000, 120_000)).toBe(
      "Temps écoulé 1 min 30 s • Encore environ 2 min",
    );
  });

  it("falls back to 'Calcul du temps restant…' when remainingMs is null", () => {
    expect(buildStatsLine(5000, null)).toBe(
      "Temps écoulé 5 s • Calcul du temps restant…",
    );
  });

  it("names the finalizing phase instead of announcing a zero remaining", () => {
    // Observed on a real 220 MB transfer: once the last byte is out, rclone
    // still assembles the multipart server-side and chiro re-reads the
    // object to verify it — ~25 s there, and it grows with the part count.
    // A full bar next to "Encore environ 0 s" for minutes reads as a crash.
    expect(buildStatsLine(28_000, 0, true)).toBe(
      "Temps écoulé 28 s • Finalisation en ligne…",
    );
    // The flag wins over a still-known estimate, too.
    expect(buildStatsLine(28_000, 4000, true)).toContain(
      "Finalisation en ligne…",
    );
  });
});

describe("buildReassuranceLines", () => {
  it("adds the long-upload line only when the estimate is at least 30 minutes", () => {
    // 3.75 MB/s reference rate (estimatedDuration.ts): well under 30 min.
    expect(
      buildReassuranceLines(50_000_000).some((l) => l.includes("long")),
    ).toBe(false);
    // 14.2 GB comfortably clears 30 min at the reference rate.
    expect(
      buildReassuranceLines(14_200_000_000).some((l) => l.includes("long")),
    ).toBe(true);
  });

  it("always includes the standing reassurance lines", () => {
    const lines = buildReassuranceLines(1000);
    expect(lines).toContain(
      "Vous pouvez laisser cette fenêtre ouverte, ça continue tout seul.",
    );
    expect(lines).toContain("Ne rabattez pas l'écran de l'ordinateur.");
    expect(
      lines.some((l) =>
        l.startsWith("Votre sauvegarde reste dans ./archived/"),
      ),
    ).toBe(true);
  });
});

describe("RunningView — running state", () => {
  it("shows the zip name, the bytes-transferred proof-of-life line, and the percent", async () => {
    const handlesBox: { current: RunningViewHandles | null } = {
      current: null,
    };
    const { lastFrame } = render(
      <RunningView
        cwd="/tmp/chiro-demo"
        chosen={chosen}
        stopping={false}
        onMount={(h) => {
          handlesBox.current = h;
        }}
      />,
    );
    expect(handlesBox.current).not.toBeNull();

    handlesBox.current?.onProgress(6_700_000_000);
    await flush();

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Archivage en ligne en cours…");
    expect(frame).toContain(chosen.name);
    expect(frame).toContain("sur");
    expect(frame).not.toContain("Arrêt en cours");
  });

  it("shows the stalled notice line once 60s pass without new bytes, and drops it again once bytes resume", async () => {
    const handlesBox: { current: RunningViewHandles | null } = {
      current: null,
    };
    const clock = { ms: 0 };
    const { lastFrame } = render(
      <RunningView
        cwd="/tmp/chiro-demo"
        chosen={chosen}
        stopping={false}
        nowFn={() => clock.ms}
        onMount={(h) => {
          handlesBox.current = h;
        }}
      />,
    );

    clock.ms += 1000;
    handlesBox.current?.onProgress(1000);
    await flush();
    expect(lastFrame() ?? "").not.toContain("La connexion est ralentie");
    expect(lastFrame() ?? "").not.toContain("Calcul du temps restant…");

    clock.ms += 61_000;
    handlesBox.current?.onProgress(1000); // no delta — 61s stall
    await flush();

    let frame = lastFrame() ?? "";
    expect(frame).toContain("⚠ La connexion est ralentie");
    expect(frame).toContain("Calcul du temps restant…");

    clock.ms += 1000;
    handlesBox.current?.onProgress(2000); // bytes resume
    await flush();

    frame = lastFrame() ?? "";
    expect(frame).not.toContain("La connexion est ralentie");
  });
});

describe("RunningView — stopping state", () => {
  it("replaces the panel with the standalone 'Arrêt en cours…' screen", () => {
    const { lastFrame } = render(
      <RunningView
        cwd="/tmp/chiro-demo"
        chosen={chosen}
        stopping={true}
        onMount={() => undefined}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Arrêt en cours…");
    expect(frame).toContain("chiro termine proprement, un instant.");
    expect(frame).not.toContain("Archivage en ligne en cours");
    expect(frame).not.toContain("%");
  });
});
