import { render } from "ink-testing-library";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConstatScreen } from "../ConstatScreen.js";

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
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "chiro-test-prefix-constat-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

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

describe("ConstatScreen (prefix) — recorder scratch files", () => {
  it("leaves temp.wav out of the count and of the files handed to the rename, and says so in a dim bullet", async () => {
    await writeFile(path.join(tmpDir, "temp.wav"), Buffer.alloc(44));
    await writeFile(path.join(tmpDir, "PaRec1_20260814_223000.wav"), "audio");
    await writeFile(path.join(tmpDir, "LogPR1.txt"), "log");

    const screen = await renderReady();

    expect(screen.lines()).toContain("✓ 1 enregistrement .wav trouvé ici");
    expect(screen.lines()).toContain(
      "• 1 autre fichier sera ignoré (pas un .wav)",
    );
    expect(screen.lines()).toContain(
      "• 1 fichier temporaire de l'enregistreur sera ignoré",
    );
    screen.pressEnter();
    await waitUntil(() => screen.onContinue.mock.calls.length > 0);
    expect(screen.onContinue.mock.calls[0]?.[1]).toEqual([
      "PaRec1_20260814_223000.wav",
    ]);
  });

  it("agrees the bullet in the plural, already prefixed form included", async () => {
    await writeFile(path.join(tmpDir, "Car123456-2026-Pass1-A1-temp.wav"), "");
    await writeFile(path.join(tmpDir, "Test.wav"), "speed test");
    await writeFile(path.join(tmpDir, "rec.wav"), "audio");

    const screen = await renderReady();

    expect(screen.lines()).toContain(
      "• 2 fichiers temporaires de l'enregistreur seront ignorés",
    );
  });

  it("still says the recordings were found in Brut/ when temp.wav sits at the root", async () => {
    await mkdir(path.join(tmpDir, "Brut"));
    await writeFile(path.join(tmpDir, "temp.wav"), Buffer.alloc(44));
    await writeFile(path.join(tmpDir, "Brut", "rec.wav"), "audio");

    const screen = await renderReady();

    expect(screen.lines()).toContain(
      "✓ 1 enregistrement .wav trouvé dans ./Brut/",
    );
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

  it("shows no such bullet when the folder has no scratch file", async () => {
    await writeFile(path.join(tmpDir, "rec.wav"), "audio");

    const screen = await renderReady();

    expect(screen.lines().join(" ")).not.toContain("temporaire");
  });
});
