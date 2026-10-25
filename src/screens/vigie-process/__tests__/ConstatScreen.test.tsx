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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConstatScreen } from "../ConstatScreen.js";
import {
  makeRampBytes,
  makeWavBytes,
} from "../../../lib/audio/__tests__/fixtures.js";

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

  it("checks spaces before the recorder mode, since prefixing fixes names without reading the audio", async () => {
    const recording = (sampleRate: number): Buffer =>
      makeWavBytes({ sampleRate, data: makeRampBytes(sampleRate * 2) });
    await writeFile(
      path.join(tmpDir, prefixedWithSpace("205005")),
      recording(250000),
    );
    await writeFile(
      path.join(tmpDir, prefixedWithSpace("205010")),
      recording(38400),
    );

    const lines = await renderLines();

    expect(lines).toContain("⚠ 2 enregistrements ont un espace dans leur nom.");
    expect(lines.join(" ")).not.toContain("mélange");
  });

  it("never reports a recorder scratch file as a name with a space", async () => {
    await writeRoot([
      "Car123456-2026-Pass1-Z 3-temp.wav",
      "Car123456-2026-Pass1-Z3-PR01_PR1925645_20260728_205005.wav",
    ]);

    const lines = await renderLines();

    expect(lines.join(" ")).not.toContain("espace dans");
    expect(lines).toContain("(1 fichier temporaire de l'enregistreur ignoré)");
  });
});

describe("ProcessConstatScreen — recorder scratch files", () => {
  const renderReady = async (): Promise<{
    lines: () => string[];
    pressEnter: () => void;
    onContinue: ReturnType<typeof vi.fn>;
  }> => {
    const onContinue = vi.fn();
    const { lastFrame, stdin } = render(
      <ConstatScreen
        cwd={tmpDir}
        onContinue={onContinue}
        onBack={() => undefined}
      />,
    );
    await waitUntil(() => !(lastFrame() ?? "").includes("Analyse du dossier…"));
    return {
      lines: () => boxLines(lastFrame() ?? ""),
      pressEnter: () => {
        stdin.write("\r");
      },
      onContinue,
    };
  };

  it("leaves temp.wav out of the count and of the files handed to the split, and says so in a discreet line", async () => {
    await writeFile(path.join(tmpDir, "temp.wav"), Buffer.alloc(44));
    await writeFile(path.join(tmpDir, "rec.wav"), "audio");

    const screen = await renderReady();

    expect(screen.lines()).toContain("✓ 1 enregistrement .wav prêt à découper");
    expect(screen.lines()).toContain(
      "(1 fichier temporaire de l'enregistreur ignoré)",
    );
    screen.pressEnter();
    await waitUntil(() => screen.onContinue.mock.calls.length > 0);
    expect(screen.onContinue).toHaveBeenCalledWith(["rec.wav"], {
      mode: "preserve",
    });
  });

  it("agrees the line in the plural for temp.wav and Test.wav", async () => {
    await writeFile(path.join(tmpDir, "temp.wav"), Buffer.alloc(44));
    await writeFile(path.join(tmpDir, "Test.wav"), "speed test");
    await writeFile(path.join(tmpDir, "rec.wav"), "audio");

    const screen = await renderReady();

    expect(screen.lines()).toContain(
      "(2 fichiers temporaires de l'enregistreur ignorés)",
    );
  });

  it("still reports recordings found only in Brut/ when temp.wav sits at the root", async () => {
    await mkdir(path.join(tmpDir, "Brut"));
    await writeFile(path.join(tmpDir, "temp.wav"), Buffer.alloc(44));
    await writeFile(path.join(tmpDir, "Brut", "rec.wav"), "audio");

    const screen = await renderReady();

    expect(screen.lines()).toContain("(trouvés dans ./Brut/)");
  });

  it("explains on the no-recording screen that the only .wav was the recorder's temporary file", async () => {
    await writeFile(path.join(tmpDir, "temp.wav"), Buffer.alloc(44));

    const screen = await renderReady();

    expect(screen.lines()).toContain(
      "Aucun enregistrement .wav trouvé dans ce dossier.",
    );
    expect(screen.lines()).toContain(
      "(1 fichier temporaire de l'enregistreur ignoré)",
    );
  });

  it("shows no such line when the folder has no scratch file", async () => {
    await writeFile(path.join(tmpDir, "rec.wav"), "audio");

    const screen = await renderReady();

    expect(screen.lines().join(" ")).not.toContain("temporaire");
  });
});

describe("ProcessConstatScreen — recorder mode detected from the header", () => {
  const recording = (sampleRate: number): Buffer =>
    makeWavBytes({ sampleRate, data: makeRampBytes(sampleRate * 2) });

  const renderScreen = async (): Promise<{
    lines: () => string[];
    pressEnter: () => void;
    onContinue: ReturnType<typeof vi.fn>;
  }> => {
    const onContinue = vi.fn();
    const { lastFrame, stdin } = render(
      <ConstatScreen
        cwd={tmpDir}
        onContinue={onContinue}
        onBack={() => undefined}
      />,
    );
    await waitUntil(() => !(lastFrame() ?? "").includes("Analyse du dossier…"));
    return {
      lines: () => boxLines(lastFrame() ?? ""),
      pressEnter: () => {
        stdin.write("\r");
      },
      onContinue,
    };
  };

  it.each([
    ["a Teensy X10 batch at 38 400 Hz is kept as is", 38400, "preserve"],
    ["an AudioMoth batch at 250 000 Hz is slowed down", 250000, "expand-10x"],
    ["a Teensy X1 batch at 384 000 Hz is slowed down", 384000, "expand-10x"],
  ])(
    "hands the detected mode to the confirmation: %s",
    async (_label, rate, mode) => {
      await writeFile(path.join(tmpDir, "a.wav"), recording(rate));
      await writeFile(path.join(tmpDir, "b.wav"), recording(rate));

      const screen = await renderScreen();
      screen.pressEnter();
      await waitUntil(() => screen.onContinue.mock.calls.length > 0);

      expect(screen.onContinue).toHaveBeenCalledWith(["a.wav", "b.wav"], {
        mode,
      });
    },
  );

  it("refuses a folder mixing both families, with each count and a first example, and Enter does nothing", async () => {
    await writeFile(path.join(tmpDir, "am1.wav"), recording(250000));
    await writeFile(path.join(tmpDir, "pr1.wav"), recording(38400));
    await writeFile(path.join(tmpDir, "pr2.wav"), recording(38400));

    const screen = await renderScreen();

    expect(screen.lines()).toContain(
      "⚠ Ce dossier mélange deux sortes d'enregistrements :",
    );
    expect(screen.lines()).toContain(
      "• 2 déjà ralentis 10× à l'enregistrement",
    );
    expect(screen.lines()).toContain("par ex. pr1.wav");
    expect(screen.lines()).toContain("• 1 à ralentir 10×");
    expect(screen.lines()).toContain("par ex. am1.wav");
    screen.pressEnter();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.onContinue).not.toHaveBeenCalled();
  });

  it("refuses unclassifiable recordings by name, asks to move them aside, and gives every rate as technical detail", async () => {
    await writeFile(path.join(tmpDir, "low1.wav"), recording(22050));
    await writeFile(path.join(tmpDir, "low2.wav"), recording(8000));
    await writeFile(path.join(tmpDir, "pr.wav"), recording(38400));

    const screen = await renderScreen();
    const text = screen.lines().join(" ");

    expect(screen.lines()).toContain(
      "⚠ chiro ne sait pas découper 2 enregistrements de ce dossier :",
    );
    expect(screen.lines()).toContain("• low1.wav");
    expect(screen.lines()).toContain("• low2.wav");
    expect(text).toContain(
      "chiro ne reconnaît pas l'enregistreur qui les a produits.",
    );
    expect(text).toContain("Déplacez-les dans un autre dossier");
    expect(text).toContain("fréquence 22050 Hz, 8000 Hz");
    expect(text).not.toContain("kHz");
  });

  it("does not ask to move the recordings aside when none of them could be split", async () => {
    await writeFile(path.join(tmpDir, "low.wav"), recording(22050));

    const screen = await renderScreen();
    const text = screen.lines().join(" ");

    expect(screen.lines()).toContain(
      "⚠ chiro ne sait pas découper l'enregistrement de ce dossier :",
    );
    expect(text).toContain(
      "chiro ne reconnaît pas l'enregistreur qui l'a produit.",
    );
    expect(text).not.toContain("Déplacez");
  });

  it("lists four unclassifiable names at most, then how many others", async () => {
    for (const name of ["l1", "l2", "l3", "l4", "l5", "l6"]) {
      await writeFile(path.join(tmpDir, `${name}.wav`), recording(22050));
    }
    await writeFile(path.join(tmpDir, "pr.wav"), recording(38400));

    const screen = await renderScreen();

    expect(screen.lines()).toContain("• l4.wav");
    expect(screen.lines()).not.toContain("• l5.wav");
    expect(screen.lines()).toContain("... et 2 autres");
  });

  it("speaks of a single unclassifiable recording in the singular", async () => {
    await writeFile(path.join(tmpDir, "low.wav"), recording(22050));
    await writeFile(path.join(tmpDir, "pr.wav"), recording(38400));

    const screen = await renderScreen();
    const text = screen.lines().join(" ");

    expect(screen.lines()).toContain(
      "⚠ chiro ne sait pas découper 1 enregistrement de ce dossier :",
    );
    expect(text).toContain(
      "chiro ne reconnaît pas l'enregistreur qui l'a produit.",
    );
    expect(text).toContain("Déplacez-le dans un autre dossier");
  });

  it("does not ask to move them aside when the other files would be refused anyway", async () => {
    await writeFile(path.join(tmpDir, "low.wav"), recording(22050));
    await writeFile(path.join(tmpDir, "broken.wav"), "not a wav");

    const screen = await renderScreen();
    const text = screen.lines().join(" ");

    expect(text).toContain(
      "chiro ne sait pas découper l'enregistrement de ce dossier",
    );
    expect(text).not.toContain("Déplacez");
  });

  it("speaks of a single already slowed recording in the singular on the mixed screen", async () => {
    await writeFile(path.join(tmpDir, "am1.wav"), recording(250000));
    await writeFile(path.join(tmpDir, "pr1.wav"), recording(38400));

    const screen = await renderScreen();

    expect(screen.lines()).toContain("• 1 déjà ralenti 10× à l'enregistrement");
  });

  it("hands preserve to the confirmation when no recording is admitted, since nothing will be split", async () => {
    await writeFile(path.join(tmpDir, "broken.wav"), "not a wav");

    const screen = await renderScreen();
    screen.pressEnter();
    await waitUntil(() => screen.onContinue.mock.calls.length > 0);

    expect(screen.onContinue).toHaveBeenCalledWith(["broken.wav"], {
      mode: "preserve",
    });
  });
});
