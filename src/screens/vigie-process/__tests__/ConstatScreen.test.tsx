import { render } from "ink-testing-library";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConstatScreen } from "../ConstatScreen.js";

const isRoot = process.getuid?.() === 0;
const itUnlessRoot = isRoot ? it.skip : it;

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

const boxLines = (frame: string): string[] =>
  frame
    .split("\n")
    .map((line) => line.replaceAll("│", "").trim())
    .filter((line) => line !== "");

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "chiro-test-process-constat-"));
});

afterEach(async () => {
  await chmod(tmpDir, 0o700).catch(() => undefined);
  await rm(tmpDir, { recursive: true, force: true });
});

describe("ProcessConstatScreen — not-writable", () => {
  itUnlessRoot(
    "stacks the guidance and both suggestions in a single column so none overlaps another",
    async () => {
      await chmod(tmpDir, 0o555);

      const { lastFrame } = render(
        <ConstatScreen
          cwd={tmpDir}
          onContinue={() => undefined}
          onBack={() => undefined}
        />,
      );

      await waitUntil(
        () => !(lastFrame() ?? "").includes("Analyse du dossier…"),
      );

      const lines = boxLines(lastFrame() ?? "");
      expect(lines).toContain("⚠ Ce dossier est protégé en écriture.");
      expect(lines.join(" ")).toContain(
        "L'outil ne peut pas créer le sous-dossier « processed » ici. Essayez de : • copier les fichiers dans un dossier de votre choix • puis relancer chiro dans ce nouveau dossier",
      );
      expect(lines).toContain(
        "• copier les fichiers dans un dossier de votre choix",
      );
      expect(lines).toContain("• puis relancer chiro dans ce nouveau dossier");
    },
  );
});

describe("ProcessConstatScreen — names with spaces", () => {
  const prefixedWithSpace = (stamp: string): string =>
    `Car123456-2026-Pass1-Z3-PR01 PR1925645_20260728_${stamp}.wav`;

  const renderLines = async (): Promise<string[]> => {
    const { lastFrame, unmount } = render(
      <ConstatScreen
        cwd={tmpDir}
        onContinue={() => undefined}
        onBack={() => undefined}
      />,
    );
    await waitUntil(() => !(lastFrame() ?? "").includes("Analyse du dossier"));
    const lines = boxLines(lastFrame() ?? "");
    unmount();
    return lines;
  };

  const writeRoot = async (names: readonly string[]): Promise<void> => {
    for (const name of names) await writeFile(path.join(tmpDir, name), "");
  };

  it("blocks the split and sends her to prefixing, since Vigie-Chiro would refuse the output", async () => {
    await writeRoot([prefixedWithSpace("205005"), prefixedWithSpace("205010")]);

    const lines = await renderLines();

    expect(lines).toContain("⚠ 2 enregistrements ont un espace dans leur nom.");
    expect(lines).toContain(
      "Vigie-Chiro refuse les espaces. Pour les remplacer par « _ » :",
    );
    expect(lines).toContain("• lancez « Préfixer des enregistrements »");
    expect(lines).toContain("• puis revenez ici");
    expect(lines).not.toContain("• renommez l'ancien dossier « processed »");
  });

  it("checks spaces before the existing processed/ folder so she gets the whole path at once", async () => {
    await writeRoot([prefixedWithSpace("205005")]);
    await mkdir(path.join(tmpDir, "processed"));
    await writeFile(path.join(tmpDir, "processed", "old_000.wav"), "");

    const lines = await renderLines();

    expect(lines).toContain("⚠ 1 enregistrement a un espace dans son nom.");
    expect(lines).toContain("• renommez l'ancien dossier « processed »");
    expect(lines.join(" ")).not.toContain("existe déjà ici");
  });

  it("does not ask to rename a processed/ folder that only holds scratch files", async () => {
    await writeRoot([prefixedWithSpace("205005")]);
    await mkdir(path.join(tmpDir, "processed"));
    await writeFile(path.join(tmpDir, "processed", "x_000.wav.tmp"), "");

    const lines = await renderLines();

    expect(lines).not.toContain("• renommez l'ancien dossier « processed »");
  });

  it("asks to remove raw copies that prefixing could never fix, instead of looping back to it", async () => {
    await writeRoot([
      "PR01 PR1925645_20260728_205005.wav",
      "Car123456-2026-Pass1-Z3-PR01_PR1925645_20260728_205005.wav",
    ]);

    const lines = await renderLines();

    expect(lines).toContain("⚠ 1 enregistrement a un espace dans son nom :");
    expect(lines).toContain("• PR01 PR1925645_20260728_205005.wav");
    expect(lines).toContain(
      "Il existe déjà dans ce dossier sous un nom préfixé :",
    );
    expect(lines).toContain("« Préfixer » ne peut donc pas le corriger.");
    expect(lines).toContain("Retirez-le du dossier, puis revenez ici.");
    expect(lines.join(" ")).not.toContain("lancez « Préfixer");
  });

  it("renames nothing while it reports spaces", async () => {
    const names = [
      prefixedWithSpace("205005"),
      "PR01 PR1925645_20260728_205010.wav",
    ];
    await writeRoot(names);

    await renderLines();

    expect((await readdir(tmpDir)).sort()).toEqual([...names].sort());
  });

  it("keeps the nominal screen when no name has a space", async () => {
    await writeRoot([
      "Car123456-2026-Pass1-Z3-PR01_PR1925645_20260728_205005.wav",
    ]);

    const lines = await renderLines();

    expect(lines.join(" ")).toContain("prêt à découper");
    expect(lines.join(" ")).not.toContain("espace dans");
  });

  it("lists at most four leftovers and counts the rest, in the plural", async () => {
    const stamps = ["01", "02", "03", "04", "05", "06"];
    await writeRoot(
      stamps.flatMap((stamp) => [
        `PR01 PR1_${stamp}.wav`,
        `Car123456-2026-Pass1-Z3-PR01_PR1_${stamp}.wav`,
      ]),
    );

    const lines = await renderLines();

    expect(lines).toContain(
      "⚠ 6 enregistrements ont un espace dans leur nom :",
    );
    expect(lines).toContain("• PR01 PR1_04.wav");
    expect(lines).not.toContain("• PR01 PR1_05.wav");
    expect(lines).toContain("... et 2 autres");
    expect(lines).toContain(
      "Ils existent déjà dans ce dossier sous un nom préfixé :",
    );
    expect(lines).toContain("Retirez-les du dossier, puis revenez ici.");
  });
});
