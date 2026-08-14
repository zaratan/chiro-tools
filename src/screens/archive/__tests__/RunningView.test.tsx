import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import type { ArchiveEntryStat } from "../../../lib/archive/planArchive.js";
import {
  buildCounterLines,
  RunningView,
  type RunningViewHandles,
} from "../RunningView.js";
import type { ArchiveProgressState } from "../useArchiveProgressState.js";

const baseState: ArchiveProgressState = {
  totalEntries: 720,
  currentEntryName: "a_214.wav",
  currentEntryIndex: 213,
  bytesRead: 0,
  elapsedMs: 0,
  remainingMs: null,
  volumeIndex: null,
};

describe("buildCounterLines — 'Fichier zip N' masking (backup vs package, N=1 vs N>1)", () => {
  it("never shows a volume line in backup mode, even with a volumeIndex set", () => {
    const lines = buildCounterLines("backup", { ...baseState, volumeIndex: 3 });
    expect(lines.some((l) => l.includes("Fichier zip"))).toBe(false);
  });

  it("hides 'Fichier zip 1' in package mode (the honest N=1 masking)", () => {
    const lines = buildCounterLines("package", {
      ...baseState,
      volumeIndex: 1,
    });
    expect(lines.some((l) => l.includes("Fichier zip"))).toBe(false);
  });

  it("shows 'Fichier zip 2' onward once a real multi-volume run advances", () => {
    const lines = buildCounterLines("package", {
      ...baseState,
      volumeIndex: 2,
    });
    expect(lines).toContain("  Fichier zip 2");
  });

  it("always includes the 'Enregistrement N sur Total' line when an entry is in flight", () => {
    const lines = buildCounterLines("package", {
      ...baseState,
      volumeIndex: 3,
    });
    expect(lines).toContain("  Enregistrement 214 sur 720");
  });

  it("omits the entry counter line before the first entry-start event", () => {
    const lines = buildCounterLines("backup", {
      ...baseState,
      currentEntryIndex: null,
    });
    expect(lines).toEqual([]);
  });
});

const sampleEntries: readonly ArchiveEntryStat[] = [
  { name: "a_001.wav", size: 4, mtime: new Date("2026-01-01T00:00:00Z") },
];

describe("RunningView — mode-specific title and reassurance lines", () => {
  it("backup mode shows the single-zip title and ./archived/ output folder", () => {
    const handlesBox: { current: RunningViewHandles | null } = {
      current: null,
    };
    const { lastFrame } = render(
      <RunningView
        mode="backup"
        cwd="/tmp/chiro-demo"
        entries={sampleEntries}
        totalBytes={4}
        onMount={(h) => {
          handlesBox.current = h;
        }}
      />,
    );
    expect(handlesBox.current).not.toBeNull();

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Création du zip en cours…");
    expect(frame).toContain("Dossier de sortie : ./archived/");
    expect(frame).not.toContain(
      "Les fichiers zip n'y apparaîtront qu'à la toute fin",
    );
  });

  it("package mode shows the multi-zip title, ./upload/ folder, and the atomicity line", () => {
    const { lastFrame } = render(
      <RunningView
        mode="package"
        cwd="/tmp/chiro-demo"
        entries={sampleEntries}
        totalBytes={4}
        onMount={() => undefined}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Création des fichiers zip en cours…");
    expect(frame).toContain("Dossier de sortie : ./upload/");
    expect(frame).toContain(
      "Les fichiers zip n'y apparaîtront qu'à la toute fin",
    );
  });

  it("shows 'Fichier zip 2' after a real 'volume-start' event fires for the second volume", async () => {
    const handlesBox: { current: RunningViewHandles | null } = {
      current: null,
    };
    const { lastFrame } = render(
      <RunningView
        mode="package"
        cwd="/tmp/chiro-demo"
        entries={sampleEntries}
        totalBytes={4}
        onMount={(h) => {
          handlesBox.current = h;
        }}
      />,
    );

    expect(lastFrame() ?? "").not.toContain("Fichier zip");

    handlesBox.current?.onProgress({ kind: "volume-start", volumeIndex: 1 });
    await new Promise((r) => setTimeout(r, 10));
    expect(lastFrame() ?? "").not.toContain("Fichier zip");

    handlesBox.current?.onProgress({ kind: "volume-start", volumeIndex: 2 });
    await new Promise((r) => setTimeout(r, 10));
    expect(lastFrame() ?? "").toContain("Fichier zip 2");
  });
});
