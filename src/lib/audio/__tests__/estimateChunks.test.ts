import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TimeExpansionMode } from "../../../types.js";
import { DEFAULT_MAX_INPUT_BYTES } from "../batchPlan.js";
import { CHUNK_OUTPUT_SECONDS } from "../constants.js";
import { estimateChunkCount } from "../estimateChunks.js";
import { splitWavFile } from "../splitWavFile.js";
import { makeRampBytes, makeWavBytes } from "./fixtures.js";

type Recording = {
  sampleRate: number;
  seconds: number;
  channels?: number;
  bitsPerSample?: number;
};

const wavBytes = (r: Recording): Buffer => {
  const channels = r.channels ?? 1;
  const bitsPerSample = r.bitsPerSample ?? 16;
  const frames = Math.round(r.sampleRate * r.seconds);
  return makeWavBytes({
    sampleRate: r.sampleRate,
    channels,
    bitsPerSample,
    data: makeRampBytes((frames * channels * bitsPerSample) / 8),
  });
};

const realChunkCount = (bytes: Buffer, mode: TimeExpansionMode): number => {
  let count = 0;
  for (const y of splitWavFile(bytes, {
    mode,
    chunkSeconds: CHUNK_OUTPUT_SECONDS,
  })) {
    if (y.kind === "chunk") count += 1;
  }
  return count;
};

describe("estimateChunkCount", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-estimate-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const write = async (name: string, bytes: Buffer): Promise<number> => {
    await writeFile(path.join(tmpDir, name), bytes);
    return bytes.byteLength;
  };

  it("returns a zero estimate for an empty file list", async () => {
    expect(await estimateChunkCount([], tmpDir, "preserve")).toEqual({
      totalChunks: 0,
      totalDurationSec: 0,
      totalBytes: 0,
    });
  });

  it.each<[string, Recording, TimeExpansionMode]>([
    [
      "a Teensy X10 at 38 400 Hz",
      { sampleRate: 38400, seconds: 110 },
      "preserve",
    ],
    [
      "a Teensy X10 at 25 000 Hz",
      { sampleRate: 25000, seconds: 101 },
      "preserve",
    ],
    [
      "an AudioMoth at 250 000 Hz",
      { sampleRate: 250000, seconds: 12 },
      "expand-10x",
    ],
    [
      "a Teensy X1 at 384 000 Hz",
      { sampleRate: 384000, seconds: 11 },
      "expand-10x",
    ],
    [
      "a stereo 24-bit file at 48 000 Hz",
      { sampleRate: 48000, seconds: 6, channels: 2, bitsPerSample: 24 },
      "expand-10x",
    ],
  ])(
    "matches the splitter's real chunk count for %s",
    async (_label, recording, mode) => {
      const bytes = wavBytes(recording);
      await write("rec.wav", bytes);

      const estimate = await estimateChunkCount(["rec.wav"], tmpDir, mode);

      expect(estimate.totalChunks).toBe(realChunkCount(bytes, mode));
    },
  );

  it("counts an AudioMoth at its real rate: 12 s at 250 000 Hz gives 3 files and 120 s once slowed down", async () => {
    await write("am.wav", wavBytes({ sampleRate: 250000, seconds: 12 }));

    const estimate = await estimateChunkCount(["am.wav"], tmpDir, "expand-10x");

    expect(estimate.totalChunks).toBe(3);
    expect(estimate.totalDurationSec).toBeCloseTo(120);
  });

  it("counts a Teensy at its real rate: 110 s at 38 400 Hz gives 3 files", async () => {
    await write("pr.wav", wavBytes({ sampleRate: 38400, seconds: 110 }));

    const estimate = await estimateChunkCount(["pr.wav"], tmpDir, "preserve");

    expect(estimate.totalChunks).toBe(3);
    expect(estimate.totalDurationSec).toBeCloseTo(110);
  });

  it("sums per-file ceilings rather than dividing the combined total", async () => {
    const justOverOneChunk = { sampleRate: 38400, seconds: 50.1 };
    await write("a.wav", wavBytes(justOverOneChunk));
    await write("b.wav", wavBytes(justOverOneChunk));

    const estimate = await estimateChunkCount(
      ["a.wav", "b.wav"],
      tmpDir,
      "preserve",
    );

    expect(estimate.totalChunks).toBe(4);
  });

  it("does not trust a declared data size larger than the file", async () => {
    await write(
      "lying.wav",
      makeWavBytes({
        sampleRate: 38400,
        data: makeRampBytes(38400 * 2),
        declaredDataSize: 0xffffffff,
      }),
    );

    const estimate = await estimateChunkCount(
      ["lying.wav"],
      tmpDir,
      "preserve",
    );

    expect(estimate.totalChunks).toBe(1);
    expect(estimate.totalDurationSec).toBeLessThan(1.1);
  });

  it("reports the files' size on disk, for the progress ETA", async () => {
    const size = await write(
      "rec.wav",
      wavBytes({ sampleRate: 38400, seconds: 1 }),
    );

    const estimate = await estimateChunkCount(["rec.wav"], tmpDir, "preserve");

    expect(estimate.totalBytes).toBe(size);
  });

  it("returns a zero estimate without touching the disk when already aborted", async () => {
    await write("rec.wav", wavBytes({ sampleRate: 38400, seconds: 1 }));
    const controller = new AbortController();
    controller.abort();

    const estimate = await estimateChunkCount(
      ["rec.wav"],
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

  it("leaves out every file the run itself would skip or refuse", async () => {
    const size = await write(
      "real.wav",
      wavBytes({ sampleRate: 38400, seconds: 1 }),
    );
    await write("real_001.wav", wavBytes({ sampleRate: 38400, seconds: 1 }));
    await write(
      "float.wav",
      makeWavBytes({
        audioFormat: 3,
        bitsPerSample: 32,
        data: makeRampBytes(64),
      }),
    );
    const hugeFile = path.join(tmpDir, "huge.wav");
    await writeFile(hugeFile, Buffer.alloc(0));
    await truncate(hugeFile, DEFAULT_MAX_INPUT_BYTES + 1);

    const estimate = await estimateChunkCount(
      ["real.wav", "real_001.wav", "float.wav", "huge.wav", "missing.wav"],
      tmpDir,
      "preserve",
    );

    expect(estimate.totalChunks).toBe(1);
    expect(estimate.totalBytes).toBe(size);
  });
});
