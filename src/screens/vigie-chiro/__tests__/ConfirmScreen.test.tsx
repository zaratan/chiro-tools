import { render } from "ink-testing-library";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FormInput } from "../../../types.js";
import { ConfirmScreen, type ApplyRenamesFn } from "../ConfirmScreen.js";

/**
 * Polls until `predicate` is true, or throws after `timeoutMs`. Needed
 * because the loading → plan-ready transition depends on real `fs` I/O
 * (`planRenames`), whose latency on the first test in a file can exceed a
 * couple of `setImmediate` ticks.
 */
const waitUntil = async (
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitUntil: timed out");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
};

/** Wait for Ink's escape-key flush (≥ 80ms). */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 80));

const input: FormInput = {
  squareCode: "040962",
  year: 2026,
  passNumber: 3,
  pointCode: "A1",
};

const renderConfirmScreen = (
  applyRenames: ApplyRenamesFn,
  runningRef: { current: boolean },
) =>
  render(
    <ConfirmScreen
      cwd="/tmp/chiro-test-does-not-exist"
      input={input}
      wavFiles={["a.wav"]}
      runningRef={runningRef}
      applyRenames={applyRenames}
      onComplete={() => undefined}
      onBack={() => undefined}
    />,
  );

/** Renders, waits for the loading→plan-ready transition, submits, and waits for run-error. */
const triggerRunError = async (
  applyRenames: ApplyRenamesFn,
  runningRef: { current: boolean },
): Promise<() => string> => {
  const { stdin, lastFrame } = renderConfirmScreen(applyRenames, runningRef);
  await waitUntil(() => !(lastFrame() ?? "").includes("Préparation du plan…"));
  stdin.write("\r");
  await waitUntil(() =>
    (lastFrame() ?? "").includes(
      "⚠ Une erreur est survenue pendant le renommage.",
    ),
  );
  await settle();
  return () => lastFrame() ?? "";
};

describe("ConfirmScreen (vigie-chiro) — run-error (degraded)", () => {
  it("shows the cwd, the full raw code (non-regression on the truncation bug), and clears runningRef, when applyRenames rejects", async () => {
    const runningRef = { current: false };
    const failingApply: ApplyRenamesFn = () =>
      Promise.reject(Object.assign(new Error("boom"), { code: "ENOSPC" }));

    const getFrame = await triggerRunError(failingApply, runningRef);

    const frame = getFrame();
    expect(frame).toContain("📁 /tmp/chiro-test-does-not-exist");
    expect(frame).toContain("⚠ Une erreur est survenue pendant le renommage.");
    expect(frame).toContain("Détail technique : ENOSPC");
    expect(frame).toContain("(à transmettre si vous demandez de l'aide)");
    expect(frame).not.toContain("ENOSP\n");
    expect(runningRef.current).toBe(false);
  });

  it("shows the capitalized French label as a sentence for a known code", async () => {
    const runningRef = { current: false };
    const failingApply: ApplyRenamesFn = () =>
      Promise.reject(Object.assign(new Error("boom"), { code: "ENOENT" }));

    const getFrame = await triggerRunError(failingApply, runningRef);

    const frame = getFrame();
    expect(frame).toContain("Le fichier a disparu pendant l'opération.");
    expect(frame).toContain("Détail technique : ENOENT");
  });

  it("shows only the raw code, without a message line, for an unrecognized code", async () => {
    const runningRef = { current: false };
    const failingApply: ApplyRenamesFn = () =>
      Promise.reject(Object.assign(new Error("boom"), { code: "EWEIRD" }));

    const getFrame = await triggerRunError(failingApply, runningRef);

    const frame = getFrame();
    expect(frame).toContain("Détail technique : EWEIRD");
    expect(frame).not.toContain("erreur inattendue");
  });

  it("shows the 'revenir au début' footer hint", async () => {
    const runningRef = { current: false };
    const failingApply: ApplyRenamesFn = () =>
      Promise.reject(Object.assign(new Error("boom"), { code: "ENOSPC" }));

    const getFrame = await triggerRunError(failingApply, runningRef);

    expect(getFrame()).toContain("Échap revenir au début");
  });
});

describe("ConfirmScreen (vigie-chiro) — nothing to rename because of collisions", () => {
  const renderPlanFor = async (
    onDisk: readonly string[],
    wavFiles: string[],
  ): Promise<string> => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "chiro-test-confirm-"));
    try {
      for (const name of onDisk) {
        await writeFile(path.join(dir, name), "");
      }
      const { lastFrame, unmount } = render(
        <ConfirmScreen
          cwd={dir}
          input={input}
          wavFiles={wavFiles}
          runningRef={{ current: false }}
          applyRenames={() => Promise.reject(new Error("unused"))}
          onComplete={() => undefined}
          onBack={() => undefined}
        />,
      );
      try {
        await waitUntil(
          () => !(lastFrame() ?? "").includes("Préparation du plan…"),
        );
        return lastFrame() ?? "";
      } finally {
        unmount();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  it("does not announce renaming zero files when every file collides", async () => {
    const frame = await renderPlanFor(
      ["a.wav", "Car040962-2026-Pass3-A1-a.wav"],
      ["a.wav"],
    );

    expect(frame).not.toContain("On va renommer");
    expect(frame).toContain("ℹ Aucun fichier ne sera renommé.");
    expect(frame).toContain("⚠ 1 fichier ne pourra pas être renommé");
  });

  it("does not claim every file is already in format when raw copies collide with the prefixed ones", async () => {
    const frame = await renderPlanFor(
      ["a.wav", "Car040962-2026-Pass3-A1-a.wav"],
      ["a.wav", "Car040962-2026-Pass3-A1-a.wav"],
    );

    expect(frame).not.toContain("Tous les fichiers");
    expect(frame).toContain("ℹ Aucun fichier ne sera renommé.");
    expect(frame).toContain("⚠ 1 fichier ne pourra pas être renommé");
    expect(frame).toContain(
      "ℹ 1 fichier sera laissé tel quel (déjà au bon format) :",
    );
  });

  it("keeps the all-already-prefixed title when nothing collides", async () => {
    const frame = await renderPlanFor(
      ["Car040962-2026-Pass3-A1-a.wav"],
      ["Car040962-2026-Pass3-A1-a.wav"],
    );

    expect(frame).toContain("ℹ Tous les fichiers (1) sont déjà au bon format.");
    expect(frame).not.toContain("Aucun fichier ne sera renommé");
  });
});
