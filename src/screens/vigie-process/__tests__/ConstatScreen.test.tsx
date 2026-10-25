import { render } from "ink-testing-library";
import { chmod, mkdtemp, rm } from "node:fs/promises";
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
