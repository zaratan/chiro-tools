import { render } from "ink-testing-library";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app.js";
import { makeRampWav } from "./lib/audio/__tests__/fixtures.js";
import type { ApplyRenamesFn } from "./screens/vigie-chiro/ConfirmScreen.js";
import type { RenamePlan, RenameOutcome } from "./types.js";

/**
 * Wait for React effects and Ink's pending-escape flush to settle.
 * ESC / arrow sequences in Ink 6 need ~80 ms to resolve.
 */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 80));

/**
 * Sample Teensy-format filenames used across tests.
 * Pattern: PaRecPR{id}_{date}_{time}.wav
 */
const TEENSY_FILES = [
  "PaRecPR1925645_20260507_210004.wav",
  "PaRecPR1925645_20260507_210009.wav",
  "PaRecPR1925645_20260507_210011.wav",
];

describe("App — end-to-end", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-e2e-"));
    // Create realistic Teensy .wav files
    await Promise.all(
      TEENSY_FILES.map((name) => writeFile(path.join(tmpDir, name), "")),
    );
    // Optional non-wav file to verify it is ignored
    await writeFile(path.join(tmpDir, "LogPR1925645.txt"), "");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("completes the nominal flow: Menu → Constat → Form → Confirm → Result A", async () => {
    const { stdin, lastFrame } = render(
      <App cwd={tmpDir} onRequestUpdate={vi.fn()} />,
    );

    // --- Menu ---
    expect(lastFrame() ?? "").toContain("chiro — outils Vigie-Chiro");
    expect(lastFrame() ?? "").toContain(
      "Préfixer des enregistrements pour Vigie-Chiro",
    );

    // Select "Préfixer" → Constat
    stdin.write("\r");
    await settle();
    // Wait a bit longer for the async directory scan to complete
    await new Promise((r) => setTimeout(r, 200));

    // --- Constat ---
    const constatFrame = lastFrame() ?? "";
    expect(constatFrame).toContain(tmpDir);
    // 3 wav files found
    expect(constatFrame).toContain("enregistrements .wav trouvés");

    // Continue → Form
    stdin.write("\r");
    await settle();

    // --- Form ---
    expect(lastFrame() ?? "").toContain("Code du carré");

    // Type squareCode (focus is on squareCode by default)
    stdin.write("040962");
    await settle();

    // Tab to year (already filled "2026"), Tab to passNumber (already "1"),
    // Tab to pointCode
    stdin.write("\t");
    await settle();
    stdin.write("\t");
    await settle();
    stdin.write("\t");
    await settle();

    // Type pointCode
    stdin.write("A1");
    await settle();

    // Submit → Confirm
    stdin.write("\r");
    await settle();
    // Wait for planRenames to complete
    await new Promise((r) => setTimeout(r, 200));

    // --- Confirm ---
    expect(lastFrame() ?? "").toContain("On va renommer");

    // Launch rename → Result variante A
    stdin.write("\r");
    // Wait for applyRenames + logSession to resolve
    await new Promise((r) => setTimeout(r, 300));

    // --- Result A ---
    const resultFrame = lastFrame() ?? "";
    expect(resultFrame).toContain("Terminé");
    // The prefix used for renaming
    expect(resultFrame).toContain("Car040962-2026-Pass1-A1-");

    // Verify disk state: all .wav files renamed, .txt untouched
    const entries = (await readdir(tmpDir)).sort();
    const wavEntries = entries.filter((name) => name.endsWith(".wav"));
    const txtEntries = entries.filter((name) => name.endsWith(".txt"));

    expect(wavEntries.length).toBe(3);
    expect(
      wavEntries.every((name) => name.startsWith("Car040962-2026-Pass1-A1-")),
    ).toBe(true);
    expect(txtEntries).toHaveLength(1);
  });

  it("interrupts the rename when Ctrl+C is pressed during execution", async () => {
    // Mock applyRenames to give us time to send Ctrl+C
    const slowApplyRenames: ApplyRenamesFn = async (
      plan: RenamePlan,
      _dir: string,
      options,
    ): Promise<RenameOutcome> => {
      const start = performance.now();
      // Wait until either the signal is aborted or 500 ms elapses
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          if (options?.signal?.aborted === true) {
            clearInterval(interval);
            resolve();
          }
        }, 20);
        setTimeout(() => {
          clearInterval(interval);
          resolve();
        }, 500);
      });
      return {
        renamed: [],
        skippedAlreadyPrefixed: plan.skippedAlreadyPrefixed,
        skippedCollision: plan.skippedCollision,
        errored: [],
        interrupted: options?.signal?.aborted === true,
        durationMs: performance.now() - start,
      };
    };

    // Create a subdirectory so logSession doesn't pollute the real ~/.chiro
    const logDir = path.join(tmpDir, "log");
    await mkdir(logDir, { recursive: true });

    const { stdin, lastFrame } = render(
      <App
        cwd={tmpDir}
        applyRenames={slowApplyRenames}
        onRequestUpdate={vi.fn()}
      />,
    );

    // Navigate Menu → Constat → Form → Confirm
    stdin.write("\r");
    await settle();
    await new Promise((r) => setTimeout(r, 200));

    stdin.write("\r");
    await settle();

    stdin.write("040962");
    await settle();
    stdin.write("\t");
    await settle();
    stdin.write("\t");
    await settle();
    stdin.write("\t");
    await settle();
    stdin.write("A1");
    await settle();

    stdin.write("\r");
    await settle();
    await new Promise((r) => setTimeout(r, 200));

    // Confirm visible
    expect(lastFrame() ?? "").toContain("On va renommer");

    // Launch rename
    stdin.write("\r");
    // Let the running state appear
    await new Promise((r) => setTimeout(r, 100));

    // Send Ctrl+C (byte 0x03 — ETX)
    stdin.write("\x03");
    await new Promise((r) => setTimeout(r, 400));

    // Result variante D
    expect(lastFrame() ?? "").toContain("Renommage arrêté à votre demande");
  });

  it("displays the update hint in the menu when bootChecker finds an update", async () => {
    const bootChecker = vi
      .fn()
      .mockResolvedValue({ availableVersion: "v0.9.9" });
    const { lastFrame, unmount } = render(
      <App cwd={tmpDir} onRequestUpdate={vi.fn()} bootChecker={bootChecker} />,
    );

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(lastFrame()).toContain("⚠ Une mise à jour est disponible (v0.9.9).");
    expect(bootChecker).toHaveBeenCalledOnce();

    unmount();
  });

  it("does not display the update hint when bootChecker returns no update", async () => {
    const bootChecker = vi.fn().mockResolvedValue({ availableVersion: null });
    const { lastFrame, unmount } = render(
      <App cwd={tmpDir} onRequestUpdate={vi.fn()} bootChecker={bootChecker} />,
    );

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(lastFrame() ?? "").not.toContain("Une mise à jour est disponible");

    unmount();
  });

  it("completes the process flow: Menu → process:constat → form → confirm → result", async () => {
    // Replace the empty .wav files with valid synthetic WAVs so the
    // processing flow has something to chunk.
    for (const name of TEENSY_FILES) {
      const buf = makeRampWav({
        sampleRate: 38400,
        bitDepth: "16",
        durationSeconds: 1,
      });
      await writeFile(path.join(tmpDir, name), buf);
    }

    const { stdin, lastFrame } = render(
      <App
        cwd={tmpDir}
        onRequestUpdate={vi.fn()}
        soxAvailability={{ kind: "absent" }}
      />,
    );

    // --- Menu --- pick "Découper les enregistrements"
    stdin.write("\x1B[B"); // down → vigie-process
    await settle();
    stdin.write("\r");
    await settle();
    await new Promise((r) => setTimeout(r, 200));

    // --- Constat ---
    expect(lastFrame() ?? "").toContain(tmpDir);
    expect(lastFrame() ?? "").toContain("prêt");

    // Continue → Form
    stdin.write("\r");
    await settle();

    // --- Form --- pick "Boîtier PaRec" (default, focused)
    expect(lastFrame() ?? "").toContain(
      "Quel type d'enregistreur a produit ces fichiers ?",
    );
    stdin.write("\r");
    await settle();
    await new Promise((r) => setTimeout(r, 200));

    // --- Confirm ---
    expect(lastFrame() ?? "").toContain("On va découper");
    expect(lastFrame() ?? "").toContain(
      "Vos fichiers d'origine ne seront pas modifiés.",
    );

    // Launch process
    stdin.write("\r");
    await new Promise((r) => setTimeout(r, 500));

    // --- Result ---
    expect(lastFrame() ?? "").toContain("Terminé");
    expect(lastFrame() ?? "").toContain("morceau");
    expect(lastFrame() ?? "").toContain(
      "Vos fichiers d'origine sont intacts dans ce dossier.",
    );

    // Source files untouched, chunks written to processed/
    const entries = (await readdir(tmpDir)).sort();
    const sourceWavs = entries.filter(
      (e) => e.endsWith(".wav") && !e.startsWith("Car"),
    );
    expect(sourceWavs.length).toBe(TEENSY_FILES.length);

    const processedEntries = await readdir(path.join(tmpDir, "processed"));
    expect(processedEntries.length).toBeGreaterThan(0);
    expect(processedEntries.every((e) => e.endsWith(".wav"))).toBe(true);
  });

  it("blocks the process flow when processed/ already contains files", async () => {
    // Write valid source WAVs and a leftover processed/ from a prior run.
    for (const name of TEENSY_FILES) {
      const buf = makeRampWav({
        sampleRate: 38400,
        bitDepth: "16",
        durationSeconds: 1,
      });
      await writeFile(path.join(tmpDir, name), buf);
    }
    await mkdir(path.join(tmpDir, "processed"), { recursive: true });
    await writeFile(
      path.join(tmpDir, "processed", "leftover.wav"),
      makeRampWav({ durationSeconds: 1 }),
    );

    const { stdin, lastFrame } = render(
      <App cwd={tmpDir} onRequestUpdate={vi.fn()} />,
    );

    stdin.write("\x1B[B"); // down → vigie-process
    await settle();
    stdin.write("\r");
    await settle();
    await new Promise((r) => setTimeout(r, 200));

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Un dossier « processed » existe déjà ici.");
    // Yellow warning, not red — non-destructive contract
    expect(frame).toContain("renommer l'ancien dossier");
  });

  it("calls onRequestUpdate when user picks update and confirms install", async () => {
    const onRequestUpdate = vi.fn();
    const bootChecker = vi.fn().mockResolvedValue({ availableVersion: null });
    const updateChecker = vi
      .fn()
      .mockResolvedValue({ kind: "ok", tagName: "v9.9.9" });

    const { stdin, lastFrame, unmount } = render(
      <App
        cwd={tmpDir}
        onRequestUpdate={onRequestUpdate}
        bootChecker={bootChecker}
        updateChecker={updateChecker}
      />,
    );

    // Navigate Menu: down arrow twice to skip vigie-process and select "Vérifier les mises à jour"
    stdin.write("\x1B[B");
    await settle();
    stdin.write("\x1B[B");
    await settle();

    // Press Enter to go to UpdateScreen
    stdin.write("\r");
    await settle();
    // Wait for the async checker to resolve
    await new Promise((r) => setTimeout(r, 200));

    // UpdateScreen mounted, checker resolved with "available"
    expect(lastFrame()).toContain(
      "Une nouvelle version est disponible : v9.9.9",
    );

    // Press Enter to confirm install
    stdin.write("\r");
    await settle();

    expect(onRequestUpdate).toHaveBeenCalledOnce();

    unmount();
  });
});
