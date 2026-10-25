import { render } from "ink-testing-library";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(screen.onContinue).toHaveBeenCalledWith(["rec.wav"]);
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
