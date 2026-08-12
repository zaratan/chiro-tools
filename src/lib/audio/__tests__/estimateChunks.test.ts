import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CHUNK_OUTPUT_SECONDS,
  EXPAND_MODE_OUTPUT_RATE as AUDIOMOTH_OUTPUT_RATE,
  PRESERVE_MODE_OUTPUT_RATE as TEENSY_RATE,
} from "../constants.js";
import { estimateChunkCount } from "../estimateChunks.js";

const BYTES_PER_SAMPLE = 2;
const samplesPerChunk = (rate: number): number => rate * CHUNK_OUTPUT_SECONDS;

describe("estimateChunkCount", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-estimate-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const writeFileOfSamples = async (
    name: string,
    sampleCount: number,
  ): Promise<void> => {
    await writeFile(
      path.join(tmpDir, name),
      Buffer.alloc(sampleCount * BYTES_PER_SAMPLE),
    );
  };

  it("returns a zero estimate for an empty file list", async () => {
    const estimate = await estimateChunkCount([], tmpDir, "preserve");
    expect(estimate).toEqual({
      totalChunks: 0,
      totalDurationSec: 0,
      totalBytes: 0,
    });
  });

  it("estimates a single file needing more than one chunk (preserve mode)", async () => {
    const perChunk = samplesPerChunk(TEENSY_RATE);
    const fileSamples = perChunk + 1; // just over one chunk's worth
    await writeFileOfSamples("a.wav", fileSamples);

    const estimate = await estimateChunkCount(["a.wav"], tmpDir, "preserve");

    expect(estimate.totalChunks).toBe(2);
    expect(estimate.totalBytes).toBe(fileSamples * BYTES_PER_SAMPLE);
    expect(estimate.totalDurationSec).toBeCloseTo(fileSamples / TEENSY_RATE);
  });

  it("sums per-file ceilings rather than dividing the combined total (rounding bug scenario)", async () => {
    // Two files, each just over one chunk boundary — each needs 2 chunks on
    // its own (4 total). A naive global division of the combined sample
    // count would only need 3 chunks, under-counting by one. The per-file
    // ceiling must win, matching what the real splitters actually produce.
    const perChunk = samplesPerChunk(TEENSY_RATE);
    const fileSamples = perChunk + 1;
    await writeFileOfSamples("a.wav", fileSamples);
    await writeFileOfSamples("b.wav", fileSamples);

    const estimate = await estimateChunkCount(
      ["a.wav", "b.wav"],
      tmpDir,
      "preserve",
    );

    const naiveGlobalChunks = Math.ceil((fileSamples * 2) / perChunk);
    expect(naiveGlobalChunks).toBe(3);
    expect(estimate.totalChunks).toBe(4);
    expect(estimate.totalChunks).not.toBe(naiveGlobalChunks);
  });

  it("uses the AudioMoth output rate in expand-10x mode", async () => {
    const perChunk = samplesPerChunk(AUDIOMOTH_OUTPUT_RATE);
    const fileSamples = perChunk; // exactly one chunk
    await writeFileOfSamples("a.wav", fileSamples);

    const estimate = await estimateChunkCount(["a.wav"], tmpDir, "expand-10x");

    expect(estimate.totalChunks).toBe(1);
    expect(estimate.totalDurationSec).toBeCloseTo(
      fileSamples / AUDIOMOTH_OUTPUT_RATE,
    );
  });

  it("skips a file that fails stat (best-effort)", async () => {
    const perChunk = samplesPerChunk(TEENSY_RATE);
    await writeFileOfSamples("real.wav", perChunk);

    const estimate = await estimateChunkCount(
      ["real.wav", "missing.wav"],
      tmpDir,
      "preserve",
    );

    expect(estimate.totalChunks).toBe(1);
    expect(estimate.totalBytes).toBe(perChunk * BYTES_PER_SAMPLE);
  });

  it("returns a zero estimate without touching the disk when already aborted", async () => {
    const perChunk = samplesPerChunk(TEENSY_RATE);
    await writeFileOfSamples("a.wav", perChunk);
    await writeFileOfSamples("b.wav", perChunk);

    const controller = new AbortController();
    controller.abort();

    const estimate = await estimateChunkCount(
      ["a.wav", "b.wav"],
      tmpDir,
      "preserve",
      controller.signal,
    );

    expect(estimate).toEqual({
      totalChunks: 0,
      totalDurationSec: 0,
      totalBytes: 0,
    });
  });
});
