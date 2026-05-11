import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyRenames } from "./fs/applyRenames.js";
import { planRenames } from "./fs/planRenames.js";
import { scanWavFiles } from "./fs/scanWavFiles.js";
import { buildPrefix } from "./vigie-chiro/prefix.js";

/**
 * E2E round-trip tests covering scanWavFiles → planRenames → applyRenames
 * against realistic fixtures inspired by Vigie-Chiro field data
 * (Teensy recorder filenames, accompanying log file, etc.).
 */

const TEENSY_FILES = [
  "PaRecPR1925645_20260507_210004.wav",
  "PaRecPR1925645_20260507_210009.wav",
  "PaRecPR1925645_20260507_210011.wav",
  "PaRecPR1925645_20260507_210018.wav",
  "PaRecPR1925645_20260507_210025.wav",
  "PaRecPR1925645_20260507_210035.wav",
  "PaRecPR1925645_20260507_210037.wav",
  "PaRecPR1925645_20260507_210040.wav",
  "PaRecPR1925645_20260507_210042.wav",
  "PaRecPR1925645_20260507_210045.wav",
] as const;

const UPPERCASE_WAV = "OTHERSTEM_20260507.WAV";
const ACCENTED_WAV = "Pâturage_20260507.wav";
const ALREADY_PREFIXED = "Car040962-2026-Pass3-A1-historical.wav";
const LOG_FILE = "LogPR1925645.txt";
const DOTFILE = ".cache.wav";
const SUBDIR = "subdir";
const SUBDIR_WAV = "ignored.wav";

const PREFIX = buildPrefix({
  squareCode: "040962",
  year: 2026,
  passNumber: 3,
  pointCode: "A1",
});

const runPipeline = async (dir: string) => {
  const files = await scanWavFiles(dir);
  const plan = await planRenames(files, PREFIX, dir);
  return applyRenames(plan, dir);
};

describe("E2E round-trip on realistic Vigie-Chiro fixtures", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-e2e-"));

    for (const name of TEENSY_FILES) {
      await writeFile(path.join(tmpDir, name), "raw");
    }
    await writeFile(path.join(tmpDir, UPPERCASE_WAV), "upper");
    await writeFile(path.join(tmpDir, ACCENTED_WAV), "accented");
    await writeFile(path.join(tmpDir, ALREADY_PREFIXED), "already");
    await writeFile(path.join(tmpDir, LOG_FILE), "log content");
    await writeFile(path.join(tmpDir, DOTFILE), "hidden");
    await mkdir(path.join(tmpDir, SUBDIR));
    await writeFile(path.join(tmpDir, SUBDIR, SUBDIR_WAV), "nested");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("renames every raw WAV (including uppercase ext and accents) and leaves the rest untouched", async () => {
    const outcome = await runPipeline(tmpDir);

    expect(outcome.renamed).toHaveLength(12);
    expect(outcome.errored).toEqual([]);
    expect(outcome.interrupted).toBe(false);
    expect(outcome.skippedAlreadyPrefixed).toEqual([ALREADY_PREFIXED]);
    expect(outcome.skippedCollision).toEqual([]);

    const allRenamedTargets = outcome.renamed.map((from) => {
      const op = TEENSY_FILES.includes(from as (typeof TEENSY_FILES)[number])
        ? `${PREFIX}${from.replace(/\.wav$/i, "")}.wav`
        : from === UPPERCASE_WAV
          ? `${PREFIX}${UPPERCASE_WAV.replace(/\.WAV$/i, "")}.wav`
          : `${PREFIX}${ACCENTED_WAV.replace(/\.wav$/i, "")}.wav`;
      return op;
    });

    for (const target of allRenamedTargets) {
      expect(target).toMatch(/^Car040962-2026-Pass3-A1-/);
      expect(target).toMatch(/\.wav$/);
    }

    const finalEntries = (await readdir(tmpDir)).sort();

    expect(finalEntries).toContain(LOG_FILE);
    expect(finalEntries).toContain(DOTFILE);
    expect(finalEntries).toContain(SUBDIR);
    expect(finalEntries).toContain(ALREADY_PREFIXED);

    const prefixedFiles = finalEntries.filter((name) =>
      name.startsWith(PREFIX),
    );
    expect(prefixedFiles).toHaveLength(13);

    const subdirEntries = await readdir(path.join(tmpDir, SUBDIR));
    expect(subdirEntries).toEqual([SUBDIR_WAV]);
  });

  it("is fully idempotent on a second run", async () => {
    await runPipeline(tmpDir);
    const stateAfterRun1 = (await readdir(tmpDir)).sort();

    const outcome2 = await runPipeline(tmpDir);

    expect(outcome2.renamed).toEqual([]);
    expect(outcome2.errored).toEqual([]);
    expect(outcome2.interrupted).toBe(false);
    expect(outcome2.skippedCollision).toEqual([]);

    expect(outcome2.skippedAlreadyPrefixed).toHaveLength(13);

    const skippedSet = new Set(outcome2.skippedAlreadyPrefixed);
    expect(skippedSet.has(ALREADY_PREFIXED)).toBe(true);
    for (const teensy of TEENSY_FILES) {
      const expectedTarget = `${PREFIX}${teensy.replace(/\.wav$/i, "")}.wav`;
      expect(skippedSet.has(expectedTarget)).toBe(true);
    }
    const upperTarget = `${PREFIX}${UPPERCASE_WAV.replace(/\.WAV$/i, "")}.wav`;
    expect(skippedSet.has(upperTarget)).toBe(true);
    const accentedTarget = `${PREFIX}${ACCENTED_WAV.replace(/\.wav$/i, "")}.wav`;
    expect(skippedSet.has(accentedTarget)).toBe(true);

    const stateAfterRun2 = (await readdir(tmpDir)).sort();
    expect(stateAfterRun2).toEqual(stateAfterRun1);
  });

  it("survives a manual deletion between runs (ENOENT resilience)", async () => {
    await runPipeline(tmpDir);

    const victim = `${PREFIX}${TEENSY_FILES[0].replace(/\.wav$/i, "")}.wav`;
    await unlink(path.join(tmpDir, victim));

    const outcome3 = await runPipeline(tmpDir);

    expect(outcome3.renamed).toEqual([]);
    expect(outcome3.errored).toEqual([]);
    expect(outcome3.interrupted).toBe(false);
    expect(outcome3.skippedAlreadyPrefixed).toHaveLength(12);
    expect(outcome3.skippedAlreadyPrefixed).not.toContain(victim);

    const finalEntries = await readdir(tmpDir);
    expect(finalEntries).not.toContain(victim);
    expect(finalEntries).toContain(LOG_FILE);
    expect(finalEntries).toContain(SUBDIR);
  });
});
