import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveBackupRedoSteps,
  sourcesNeedPrefixing,
} from "../backupRedoSteps.js";

describe("sourcesNeedPrefixing", () => {
  it("is false once every source is prefixed without a space, the case where Préfixer has nothing to do", () => {
    expect(
      sourcesNeedPrefixing([
        "Car123456-2026-Pass1-A1-x.wav",
        "Brut/Car123456-2026-Pass2-A1-y.wav",
      ]),
    ).toBe(false);
  });

  it("is true while one source is still unprefixed", () => {
    expect(
      sourcesNeedPrefixing(["Car123456-2026-Pass1-A1-x.wav", "PaRec_y.wav"]),
    ).toBe(true);
  });

  it("is true for a prefixed source that still holds a space, which Préfixer fixes", () => {
    expect(sourcesNeedPrefixing(["Car123456-2026-Pass1-A1-PR01 x.wav"])).toBe(
      true,
    );
  });

  it("keeps the step when no source is left to judge from", () => {
    expect(sourcesNeedPrefixing([])).toBe(true);
  });
});

describe("resolveBackupRedoSteps", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "chiro-test-redo-steps-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  const writeIn = async (dir: string, names: readonly string[]) => {
    await mkdir(path.join(cwd, dir), { recursive: true });
    for (const name of names) {
      await writeFile(path.join(cwd, dir, name), "");
    }
  };

  it("asks for a new backup only when processed/ already shares a prefix, so she does not split again for nothing", async () => {
    await writeIn("processed", ["Car340581-2026-Pass1-A1-x_000.wav"]);
    await writeIn(".", ["PaRec_x.wav"]);

    expect(await resolveBackupRedoSteps(cwd)).toEqual({
      prefix: false,
      split: false,
    });
  });

  it("asks to prefix and split again when neither processed/ nor the sources carry a prefix", async () => {
    await writeIn("processed", ["PaRec_x_000.wav"]);
    await writeIn(".", ["PaRec_x.wav"]);

    expect(await resolveBackupRedoSteps(cwd)).toEqual({
      prefix: true,
      split: true,
    });
  });

  it("skips prefixing but asks to split again when only the sources were prefixed since", async () => {
    await writeIn("processed", ["PaRec_x_000.wav"]);
    await writeIn(".", ["Car340581-2026-Pass1-A1-PaRec_x.wav"]);

    expect(await resolveBackupRedoSteps(cwd)).toEqual({
      prefix: false,
      split: true,
    });
  });

  it("asks for every step when processed/ is gone, since the split has to be redone anyway", async () => {
    await writeIn(".", ["PaRec_x.wav"]);

    expect(await resolveBackupRedoSteps(cwd)).toEqual({
      prefix: true,
      split: true,
    });
  });
});
