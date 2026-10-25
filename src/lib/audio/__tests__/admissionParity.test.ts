import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { processWavFiles, type ProcessResult } from "../processWavFiles.js";
import { makeRampBytes, makeRampWav, makeWavBytes } from "./fixtures.js";

const findSoxBin = (): string | null => {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir === "") continue;
    const candidate = path.join(dir, "sox");
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

const SOX_BIN = findSoxBin();
const RATE = 8000;
const FRAMES = RATE * 60;

const LOT: Record<string, Uint8Array> = {
  "pcm16.wav": makeRampWav({ sampleRate: RATE, durationSeconds: 60 }),
  "float32.wav": makeWavBytes({
    sampleRate: RATE,
    audioFormat: 3,
    bitsPerSample: 32,
    data: makeRampBytes(FRAMES * 4),
  }),
  "alaw.wav": makeWavBytes({
    sampleRate: RATE,
    audioFormat: 6,
    bitsPerSample: 8,
    data: makeRampBytes(FRAMES),
  }),
  "pcm8.wav": makeWavBytes({
    sampleRate: RATE,
    bitsPerSample: 8,
    data: makeRampBytes(FRAMES),
  }),
  "pcm32.wav": makeWavBytes({
    sampleRate: RATE,
    bitsPerSample: 32,
    data: makeRampBytes(FRAMES * 4),
  }),
  "ext16.wav": makeWavBytes({
    sampleRate: RATE,
    extensibleSubformat: 1,
    data: makeRampBytes(FRAMES * 2),
  }),
  "ext24.wav": makeWavBytes({
    sampleRate: RATE,
    bitsPerSample: 24,
    extensibleSubformat: 1,
    data: makeRampBytes(FRAMES * 3),
  }),
  "header-only.wav": makeWavBytes({ sampleRate: RATE }),
  "data-zero.wav": makeWavBytes({
    sampleRate: RATE,
    declaredDataSize: 0,
    trailingBytes: makeRampBytes(FRAMES * 2),
  }),
};

const EXPECTED_PROCESSED = ["ext16.wav", "ext24.wav", "pcm16.wav"];
const EXPECTED_ERRORED = [
  { file: "alaw.wav", reason: "unsupported-format" },
  { file: "data-zero.wav", reason: "no-samples" },
  { file: "float32.wav", reason: "unsupported-format" },
  { file: "header-only.wav", reason: "no-samples" },
  { file: "pcm32.wav", reason: "unsupported-bit-depth" },
  { file: "pcm8.wav", reason: "unsupported-bit-depth" },
];

const processedNames = (result: ProcessResult): string[] =>
  result.processed.map((p) => p.sourceFile).sort();

const erroredSorted = (result: ProcessResult): typeof EXPECTED_ERRORED =>
  [...result.errored].sort((a, b) => a.file.localeCompare(b.file));

const readOutputs = async (dir: string): Promise<Map<string, Buffer>> => {
  const outDir = path.join(dir, "processed");
  const outputs = new Map<string, Buffer>();
  for (const name of (await readdir(outDir)).sort()) {
    outputs.set(name, await readFile(path.join(outDir, name)));
  }
  return outputs;
};

describe.skipIf(SOX_BIN === null)(
  "admission parity between sox and the worker pool",
  () => {
    let soxDir: string;
    let poolDir: string;

    beforeEach(async () => {
      soxDir = await mkdtemp(path.join(tmpdir(), "chiro-parity-sox-"));
      poolDir = await mkdtemp(path.join(tmpdir(), "chiro-parity-pool-"));
    });

    afterEach(async () => {
      await rm(soxDir, { recursive: true, force: true });
      await rm(poolDir, { recursive: true, force: true });
    });

    const runBoth = async (
      files: string[],
    ): Promise<{ sox: ProcessResult; pool: ProcessResult }> => {
      for (const name of files) {
        const bytes = LOT[name];
        if (bytes === undefined) throw new Error(`unknown fixture ${name}`);
        await writeFile(path.join(soxDir, name), bytes);
        await writeFile(path.join(poolDir, name), bytes);
      }
      const binPath = SOX_BIN ?? "";
      const sox = await processWavFiles(
        files,
        soxDir,
        { mode: "preserve" },
        { sox: { binPath } },
      );
      const pool = await processWavFiles(files, poolDir, { mode: "preserve" });
      return { sox, pool };
    };

    it("processes and refuses the same files with the same codes, and writes the same bytes", async () => {
      const { sox, pool } = await runBoth(Object.keys(LOT));

      expect(sox.engine).toBe("sox");
      expect(sox.engine_fallback_count).toBe(0);
      expect(processedNames(sox)).toEqual(EXPECTED_PROCESSED);
      expect(processedNames(pool)).toEqual(EXPECTED_PROCESSED);
      expect(erroredSorted(sox)).toEqual(EXPECTED_ERRORED);
      expect(erroredSorted(pool)).toEqual(EXPECTED_ERRORED);
      expect(await readOutputs(soxDir)).toEqual(await readOutputs(poolDir));
    }, 60_000);

    it("keeps a batch on sox when its first file is refused at admission", async () => {
      const { sox, pool } = await runBoth(["float32.wav", "pcm16.wav"]);

      expect(sox.engine).toBe("sox");
      expect(sox.engine_fallback_count).toBe(0);
      expect(processedNames(sox)).toEqual(["pcm16.wav"]);
      expect(erroredSorted(sox)).toEqual(erroredSorted(pool));
    }, 60_000);

    it("keeps a batch on sox when its first file is EXTENSIBLE PCM", async () => {
      const { sox, pool } = await runBoth(["ext24.wav", "pcm16.wav"]);

      expect(sox.engine).toBe("sox");
      expect(sox.engine_fallback_count).toBe(0);
      expect(processedNames(sox)).toEqual(["ext24.wav", "pcm16.wav"]);
      expect(processedNames(pool)).toEqual(["ext24.wav", "pcm16.wav"]);
      expect(await readOutputs(soxDir)).toEqual(await readOutputs(poolDir));
    }, 60_000);
  },
);
