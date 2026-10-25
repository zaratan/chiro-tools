import { render } from "ink-testing-library";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "chiro-test-prefix-constat-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("ConstatScreen (vigie-chiro) — whitespace in names", () => {
  it("announces the prefixed names whose spaces will change instead of calling them already in format", async () => {
    for (const name of [
      "Car123456-2026-Pass1-Z3-PR01 PR1925645_20260728_205005.wav",
      "Car123456-2026-Pass1-Z3-PR01 PR1925645_20260728_205010.wav",
      "Car123456-2026-Pass1-Z3-PR01_PR1925645_20260728_205015.wav",
    ]) {
      await writeFile(path.join(tmpDir, name), "");
    }

    const { lastFrame, unmount } = render(
      <ConstatScreen
        cwd={tmpDir}
        onContinue={() => undefined}
        onBack={() => undefined}
      />,
    );
    await waitUntil(() => !(lastFrame() ?? "").includes("Analyse du dossier"));
    const frame = lastFrame() ?? "";
    unmount();

    expect(frame).toContain(
      "1 fichier déjà au bon format sera laissé tel quel",
    );
    expect(frame).toContain(
      "• 2 fichiers déjà préfixés : les espaces deviendront « _ »",
    );
  });
});
