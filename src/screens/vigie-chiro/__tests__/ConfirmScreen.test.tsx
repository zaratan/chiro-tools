import { render } from "ink-testing-library";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
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
      onEditInput={() => undefined}
      onBackToConstat={() => undefined}
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
          onEditInput={() => undefined}
          onBackToConstat={() => undefined}
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

  it("shows the prefix every file already carries and says there is nothing to rename", async () => {
    const frame = await renderPlanFor(
      ["Car040962-2026-Pass3-A1-a.wav"],
      ["Car040962-2026-Pass3-A1-a.wav"],
    );

    expect(frame).toContain("ℹ Le fichier porte déjà le préfixe");
    expect(frame).toContain("    Car040962-2026-Pass3-A1-");
    expect(frame).toContain("Rien à renommer.");
    expect(frame).toContain("Entrée continuer");
    expect(frame).toContain("Échap retour à la saisie");
    expect(frame).not.toContain("Aucun fichier ne sera renommé");
    expect(frame).not.toContain("Seuls les espaces changent");
    expect(frame).not.toContain("Le nom original est conservé");
  });

  it("counts the files that already carry the prefix in the plural", async () => {
    const names = [
      "Car040962-2026-Pass3-A1-a.wav",
      "Car040962-2026-Pass3-A1-b.wav",
    ];
    const frame = await renderPlanFor(names, names);

    expect(frame).toContain("ℹ Les 2 fichiers portent déjà le préfixe");
  });
});

describe("ConfirmScreen (vigie-chiro) — names with spaces", () => {
  const prefixed = (stamp: string): string =>
    `Car123456-2026-Pass1-Z3-PR01 PR1925645_20260728_${stamp}.wav`;
  const sameInput: FormInput = {
    squareCode: "123456",
    year: 2026,
    passNumber: 1,
    pointCode: "Z3",
  };

  const renderPlanFor = async (wavFiles: string[]): Promise<string> => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "chiro-test-confirm-"));
    try {
      for (const name of wavFiles) {
        await writeFile(path.join(dir, name), "");
      }
      const { lastFrame, unmount } = render(
        <ConfirmScreen
          cwd={dir}
          input={sameInput}
          wavFiles={wavFiles}
          runningRef={{ current: false }}
          applyRenames={() => Promise.reject(new Error("unused"))}
          onComplete={() => undefined}
          onEditInput={() => undefined}
          onBackToConstat={() => undefined}
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

  it("previews the space fixes in their own block, without announcing zero prefixed files", async () => {
    const frame = await renderPlanFor([
      prefixed("205005"),
      prefixed("205010"),
      prefixed("205015"),
      prefixed("205020"),
      prefixed("205025"),
    ]);
    const inside = frame
      .split("\n")
      .map((line) => line.slice(2, -1).trimEnd())
      .join("\n");

    expect(frame).not.toContain("On va renommer");
    expect(frame).toContain(
      "Les espaces deviendront « _ » dans 5 fichiers déjà préfixés :",
    );
    expect(frame).toContain("Les 2 autres suivent le même format.");
    expect(inside).toContain(
      "    Car123456-2026-Pass1-Z3-PR01 PR1925645_20260728_205005.wav\n  → Car123456-2026-Pass1-Z3-PR01_PR1925645_20260728_205005.wav",
    );
    expect(frame).toContain(
      "Seuls les espaces changent : le reste du nom est conservé.",
    );
    expect(frame).toContain("Entrée renommer");
  });

  it("keeps one example per block when both rename blocks show, so the title stays on a 24-line terminal", async () => {
    const stamps = ["205005", "205010", "205015", "205020", "205025"];
    const frame = await renderPlanFor([
      ...stamps.map((stamp) => `PR01 PR1925645_20260801_${stamp}.wav`),
      ...stamps.map(prefixed),
    ]);

    expect(frame.split("\n").length).toBeLessThanOrEqual(24);
    expect(frame).toContain("On va renommer 5 fichiers comme ceci :");
    expect(frame).not.toContain("suivent le même format");
    expect(frame.match(/→ /g)).toHaveLength(2);
  });

  it("shows a single space example when files already in format are listed too", async () => {
    const frame = await renderPlanFor([
      prefixed("205005"),
      prefixed("205010"),
      prefixed("205015"),
      "Car123456-2026-Pass1-Z3-PR01_PR1925645_20260728_205020.wav",
    ]);

    expect(frame).toContain("Les 2 autres suivent le même format.");
    expect(frame).toContain("Seuls les espaces changent");
  });

  it("keeps the prefix count true and shows a single space example when the prefix block is there too", async () => {
    const frame = await renderPlanFor([
      "PR01 PR1925645_20260728_210000.wav",
      prefixed("205005"),
      prefixed("205010"),
      prefixed("205015"),
    ]);

    expect(frame).toContain("On va renommer 1 fichier comme ceci :");
    expect(frame).toContain(
      "→ Car123456-2026-Pass1-Z3-PR01_PR1925645_20260728_210000.wav",
    );
    expect(frame).toContain(
      "Les espaces deviendront « _ » dans 3 fichiers déjà préfixés :",
    );
    expect(frame).not.toContain("suivent le même format");
    expect(frame).toContain(
      "Le nom original est conservé en fin du nouveau nom",
    );
  });
});

describe("ConfirmScreen (vigie-chiro) — files with another prefix", () => {
  const pass1 = "Car123456-2026-Pass1-A1-";
  const pass2Input: FormInput = {
    squareCode: "123456",
    year: 2026,
    passNumber: 2,
    pointCode: "A1",
  };
  const stamped = (stamp: string): string =>
    `${pass1}PaRec1_20260728_${stamp}.wav`;

  const renderPlanFor = async (wavFiles: string[]): Promise<string> => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "chiro-test-confirm-"));
    try {
      for (const name of wavFiles) {
        await writeFile(path.join(dir, name), "");
      }
      const { lastFrame, unmount } = render(
        <ConfirmScreen
          cwd={dir}
          input={pass2Input}
          wavFiles={wavFiles}
          runningRef={{ current: false }}
          applyRenames={() => Promise.reject(new Error("unused"))}
          onComplete={() => undefined}
          onEditInput={() => undefined}
          onBackToConstat={() => undefined}
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

  const inside = (frame: string): string =>
    frame
      .split("\n")
      .map((line) => line.slice(2, -1).trimEnd())
      .join("\n");

  it("shows the prefix found and old → new examples instead of saying everything is in format", async () => {
    const frame = await renderPlanFor(
      ["205005", "205010", "205015", "205020", "205025"].map(stamped),
    );

    expect(frame).toContain("⚠ 5 fichiers portent déjà un autre préfixe :");
    expect(inside(frame)).toContain(
      "⚠ 5 fichiers portent déjà un autre préfixe :\n    Car123456-2026-Pass1-A1-\n  L'ancien préfixe sera remplacé par le nouveau :",
    );
    expect(inside(frame)).toContain(
      "    Car123456-2026-Pass1-A1-PaRec1_20260728_205005.wav\n  → Car123456-2026-Pass2-A1-PaRec1_20260728_205005.wav",
    );
    expect(frame.match(/→ /g)).toHaveLength(2);
    expect(frame).toContain("Les 3 autres suivent le même format.");
    expect(frame).not.toContain("bon format");
    expect(frame).not.toContain("On va renommer");
    expect(frame).toContain("Entrée renommer");
  });

  it("shows every file rather than one left over when there are three", async () => {
    const frame = await renderPlanFor(
      ["205005", "205010", "205015"].map(stamped),
    );

    expect(frame.match(/→ /g)).toHaveLength(3);
    expect(frame).not.toContain("suivent le même format");
  });

  it("speaks of a single file in the singular", async () => {
    const frame = await renderPlanFor([stamped("205005")]);

    expect(frame).toContain("⚠ 1 fichier porte déjà un autre préfixe :");
  });

  it("keeps the prefixes found on one line when there are several", async () => {
    const frame = await renderPlanFor([
      stamped("205005"),
      "Car123456-2026-Pass3-A1-PaRec1_20260728_205010.wav",
      "Car123456-2026-Pass4-A1-PaRec1_20260728_205015.wav",
    ]);

    expect(frame).toContain(
      "    Car123456-2026-Pass1-A1-  et 2 autres préfixes",
    );
  });

  it("takes its examples from different prefixes when several are found", async () => {
    const frame = await renderPlanFor([
      stamped("205005"),
      stamped("205010"),
      "Car123456-2026-Pass3-A1-PaRec1_20260728_205015.wav",
      "Car123456-2026-Pass3-A1-PaRec1_20260728_205020.wav",
      "Car654321-2025-Pass1-B2-PaRec1_20260728_205025.wav",
    ]);

    expect(frame).toContain(
      "    Car123456-2026-Pass1-A1-PaRec1_20260728_205005.wav",
    );
    expect(frame).toContain(
      "    Car123456-2026-Pass3-A1-PaRec1_20260728_205015.wav",
    );
    expect(frame).not.toContain(
      "    Car123456-2026-Pass1-A1-PaRec1_20260728_205010.wav",
    );
  });

  it("says one other prefix in the singular", async () => {
    const frame = await renderPlanFor([
      stamped("205005"),
      "Car123456-2026-Pass3-A1-PaRec1_20260728_205010.wav",
    ]);

    expect(frame).toContain("    Car123456-2026-Pass1-A1-  et 1 autre préfixe");
  });

  it("keeps the title on a 24-line terminal with the three rename blocks", async () => {
    const stamps = ["205005", "205010", "205015", "205020", "205025"];
    const frame = await renderPlanFor([
      ...stamps.map((stamp) => `PaRec1_20260801_${stamp}.wav`),
      ...stamps.map(stamped),
      ...stamps.map(
        (stamp) => `Car123456-2026-Pass2-A1-PR01 PR1_20260802_${stamp}.wav`,
      ),
    ]);

    expect(frame.split("\n").length).toBeLessThanOrEqual(24);
    expect(frame).toContain("On va renommer 5 fichiers comme ceci :");
    expect(frame).toContain("⚠ 5 fichiers portent déjà un autre préfixe :");
    expect(frame).toContain(
      "Les espaces deviendront « _ » dans 5 fichiers déjà préfixés :",
    );
    expect(frame.match(/→ /g)).toHaveLength(3);
    expect(frame).not.toContain("suivent le même format");
  });

  it("replaces the prefix and the spaces of a file in one go", async () => {
    const frame = await renderPlanFor([`${pass1}PR01 PR1_205005.wav`]);

    expect(frame).toContain("→ Car123456-2026-Pass2-A1-PR01_PR1_205005.wav");
    expect(frame).not.toContain("Les espaces deviendront");
  });

  it("does not say only spaces change when an old prefix is replaced too", async () => {
    const frame = await renderPlanFor([
      stamped("205005"),
      "Car123456-2026-Pass2-A1-PR01 PR1_20260802_205005.wav",
    ]);

    expect(frame).not.toContain("Seuls les espaces changent");
    expect(frame).toContain("Le nom original est conservé");
  });
});

describe("ConfirmScreen (vigie-chiro) — Échap", () => {
  const renderWith = (applyRenames: ApplyRenamesFn) => {
    const onEditInput = vi.fn();
    const onBackToConstat = vi.fn();
    const rendered = render(
      <ConfirmScreen
        cwd="/tmp/chiro-test-does-not-exist"
        input={input}
        wavFiles={["a.wav"]}
        runningRef={{ current: false }}
        applyRenames={applyRenames}
        onComplete={() => undefined}
        onEditInput={onEditInput}
        onBackToConstat={onBackToConstat}
      />,
    );
    return { ...rendered, onEditInput, onBackToConstat };
  };

  it("goes back to the form on the plan, as the footer says", async () => {
    const screen = renderWith(() => Promise.reject(new Error("unused")));
    await waitUntil(
      () => !(screen.lastFrame() ?? "").includes("Préparation du plan…"),
    );

    screen.stdin.write("\x1B");
    await settle();

    expect(screen.onEditInput).toHaveBeenCalledTimes(1);
    expect(screen.onBackToConstat).not.toHaveBeenCalled();
  });

  it("starts again from the Constat after an error, as « revenir au début » says", async () => {
    const screen = renderWith(() => Promise.reject(new Error("boom")));
    await waitUntil(
      () => !(screen.lastFrame() ?? "").includes("Préparation du plan…"),
    );
    screen.stdin.write("\r");
    await waitUntil(() =>
      (screen.lastFrame() ?? "").includes("Échap revenir au début"),
    );
    await settle();

    screen.stdin.write("\x1B");
    await settle();

    expect(screen.onBackToConstat).toHaveBeenCalledTimes(1);
    expect(screen.onEditInput).not.toHaveBeenCalled();
  });
});
