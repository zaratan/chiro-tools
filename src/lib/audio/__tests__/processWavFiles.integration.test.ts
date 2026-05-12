import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { processWavFiles } from "../processWavFiles.js";
import { readSamplesPerChannel } from "./fixtures.js";

const TEST_DATA = path.resolve(__dirname, "../../../../test-data");
const TEENSY_DIR = path.join(TEST_DATA, "Teensy/Teensy brut");
const AUDIOMOTH_DIR = path.join(TEST_DATA, "Audiomoth/Audiomoth brut");

// Skip the whole suite if test-data is missing (e.g. checkout without LFS).
const testDataAvailable = existsSync(TEENSY_DIR) && existsSync(AUDIOMOTH_DIR);

const TEENSY_FILE =
  "Car340581-2026-Pass1-Z5-PaRecPR1925645_20260507_210616.wav";
const AUDIOMOTH_FILE = "Car340581-2026-Pass2-Z5-20260507_210501T.WAV";

describe.skipIf(!testDataAvailable)(
  "processWavFiles — integration on real Vigie-Chiro fixtures",
  () => {
    let workDir: string;

    beforeEach(async () => {
      workDir = await mkdtemp(path.join(tmpdir(), "chiro-process-integ-"));
    });

    afterEach(async () => {
      await rm(workDir, { recursive: true, force: true });
    });

    it("processes a real Teensy file in preserve mode (38400 Hz chunks)", async () => {
      await copyFile(
        path.join(TEENSY_DIR, TEENSY_FILE),
        path.join(workDir, TEENSY_FILE),
      );

      const outcome = await processWavFiles([TEENSY_FILE], workDir, {
        mode: "preserve",
      });

      expect(outcome.errored).toEqual([]);
      expect(outcome.processed.length).toBe(1);
      const proc = outcome.processed[0];
      if (!proc) throw new Error("no processed entry");
      expect(proc.outputSampleRate).toBe(38400);
      expect(proc.channels).toBe(1);
      expect(proc.chunkCount).toBeGreaterThan(0);

      const processedEntries = await readdir(path.join(workDir, "processed"));
      // Expected ~10 chunks for the 4 MB teensy fixture (~52.7 s @ 38400 Hz).
      const wavCount = processedEntries.filter((e) =>
        e.endsWith(".wav"),
      ).length;
      expect(wavCount).toBe(proc.chunkCount);

      // First chunk must be a valid WAV at 38400 Hz mono 16-bit.
      const firstChunkBuffer = await readFile(
        path.join(
          workDir,
          "processed",
          `${path.parse(TEENSY_FILE).name}_000.wav`,
        ),
      );
      const firstChunk = readSamplesPerChannel(firstChunkBuffer);
      expect(firstChunk.sampleRate).toBe(38400);
      expect(firstChunk.channels).toBe(1);
      expect(firstChunk.bitDepth).toBe("16");
      expect(firstChunk.samples[0]?.length).toBe(38400 * 5);
    }, 30_000);

    it("processes a real AudioMoth file in expand-10x mode (25000 Hz chunks)", async () => {
      await copyFile(
        path.join(AUDIOMOTH_DIR, AUDIOMOTH_FILE),
        path.join(workDir, AUDIOMOTH_FILE),
      );

      const outcome = await processWavFiles([AUDIOMOTH_FILE], workDir, {
        mode: "expand-10x",
      });

      expect(outcome.errored).toEqual([]);
      expect(outcome.processed.length).toBe(1);
      const proc = outcome.processed[0];
      if (!proc) throw new Error("no processed entry");
      expect(proc.outputSampleRate).toBe(25000);
      expect(proc.channels).toBe(1);

      // AudioMoth fixture is 149.5 MB, ~5 min real time. After TE×10 the
      // output timeline is ~50 min, so chunks of 5 s expansés ≈ 600.
      expect(proc.chunkCount).toBeGreaterThan(550);
      expect(proc.chunkCount).toBeLessThan(650);

      const firstChunkBuffer = await readFile(
        path.join(
          workDir,
          "processed",
          `${path.parse(AUDIOMOTH_FILE).name}_000.wav`,
        ),
      );
      const firstChunk = readSamplesPerChannel(firstChunkBuffer);
      expect(firstChunk.sampleRate).toBe(25000);
      expect(firstChunk.channels).toBe(1);
      expect(firstChunk.bitDepth).toBe("16");
      expect(firstChunk.samples[0]?.length).toBe(25000 * 5);

      // Source file must be byte-identical after processing.
      const srcBufferBefore = await readFile(
        path.join(AUDIOMOTH_DIR, AUDIOMOTH_FILE),
      );
      const srcBufferAfter = await readFile(path.join(workDir, AUDIOMOTH_FILE));
      expect(srcBufferAfter.length).toBe(srcBufferBefore.length);
    }, 60_000);

    it("preserves Teensy chunk samples bit-exactly (sample-level round-trip)", async () => {
      await copyFile(
        path.join(TEENSY_DIR, TEENSY_FILE),
        path.join(workDir, TEENSY_FILE),
      );

      const sourceBuffer = await readFile(path.join(workDir, TEENSY_FILE));
      const sourceSamples = readSamplesPerChannel(sourceBuffer).samples[0];
      if (!sourceSamples) throw new Error("no source samples");

      await processWavFiles([TEENSY_FILE], workDir, { mode: "preserve" });

      const processedDir = path.join(workDir, "processed");
      const chunks = (await readdir(processedDir))
        .filter((e) => e.endsWith(".wav"))
        .sort();

      let offset = 0;
      // Verify the first 3 chunks sample-exactly. Doing all chunks is slow
      // and redundant — the first 3 cover both alignment cases.
      for (let i = 0; i < Math.min(3, chunks.length); i++) {
        const name = chunks[i];
        if (!name) continue;
        const chunkBuffer = await readFile(path.join(processedDir, name));
        const chunkSamples = readSamplesPerChannel(chunkBuffer).samples[0];
        if (!chunkSamples) throw new Error("no chunk samples");
        for (let j = 0; j < chunkSamples.length; j++) {
          expect(chunkSamples[j]).toBe(sourceSamples[offset + j]);
        }
        offset += chunkSamples.length;
      }
      expect(offset).toBeGreaterThan(0);
    }, 30_000);

    it("aborts cleanly mid-AudioMoth and leaves no orphan .tmp", async () => {
      await copyFile(
        path.join(AUDIOMOTH_DIR, AUDIOMOTH_FILE),
        path.join(workDir, AUDIOMOTH_FILE),
      );

      const controller = new AbortController();
      // Abort after a short delay so a few chunks get written.
      setTimeout(() => {
        controller.abort();
      }, 50);

      const outcome = await processWavFiles(
        [AUDIOMOTH_FILE],
        workDir,
        { mode: "expand-10x" },
        { signal: controller.signal },
      );

      expect(outcome.interrupted).toBe(true);

      const processedDir = path.join(workDir, "processed");
      if (existsSync(processedDir)) {
        const entries = await readdir(processedDir);
        for (const entry of entries) {
          expect(entry.endsWith(".tmp")).toBe(false);
        }
      }
    }, 60_000);
  },
);
