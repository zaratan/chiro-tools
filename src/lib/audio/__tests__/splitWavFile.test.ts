import { describe, expect, it } from "vitest";
import {
  splitWavFile,
  type EncodedChunk,
  type SplitWavYield,
} from "../splitWavFile.js";
import { makeRampWav, readSamplesPerChannel } from "./fixtures.js";

const collectChunks = (
  iter: Generator<SplitWavYield>,
): {
  chunks: EncodedChunk[];
  aborted: boolean;
  error: string | null;
} => {
  const chunks: EncodedChunk[] = [];
  let aborted = false;
  let error: string | null = null;
  for (const y of iter) {
    if (y.kind === "chunk") chunks.push(y.chunk);
    if (y.kind === "abort") aborted = true;
    if (y.kind === "error") error = y.code;
  }
  return { chunks, aborted, error };
};

describe("splitWavFile", () => {
  it("returns invalid-header for a non-WAV buffer", () => {
    const garbage = new Uint8Array([0, 1, 2, 3, 4]);
    const result = collectChunks(
      splitWavFile(garbage, { mode: "preserve", chunkSeconds: 5 }),
    );

    expect(result.error).toBe("invalid-header");
    expect(result.chunks).toEqual([]);
  });

  it("splits a 1-second mono 16-bit WAV into one full chunk (preserve)", () => {
    const wav = makeRampWav({
      channels: 1,
      sampleRate: 48000,
      bitDepth: "16",
      durationSeconds: 1,
    });
    const result = collectChunks(
      splitWavFile(wav, { mode: "preserve", chunkSeconds: 5 }),
    );

    expect(result.error).toBeNull();
    expect(result.chunks.length).toBe(1);
    const chunk0 = result.chunks[0];
    if (!chunk0) throw new Error("no chunk");
    expect(chunk0.index).toBe(0);
    expect(chunk0.outputSampleRate).toBe(48000);
    expect(chunk0.channels).toBe(1);
    expect(chunk0.samplesInChunk).toBe(48000);
  });

  it("splits a 11-second WAV into 2 full chunks + 1 partial tail", () => {
    const wav = makeRampWav({
      channels: 1,
      sampleRate: 48000,
      bitDepth: "16",
      durationSeconds: 11,
    });
    const result = collectChunks(
      splitWavFile(wav, { mode: "preserve", chunkSeconds: 5 }),
    );

    expect(result.error).toBeNull();
    expect(result.chunks.length).toBe(3);
    const [c0, c1, c2] = result.chunks;
    if (!c0 || !c1 || !c2) throw new Error("missing chunks");
    expect(c0.samplesInChunk).toBe(48000 * 5);
    expect(c1.samplesInChunk).toBe(48000 * 5);
    expect(c2.samplesInChunk).toBe(48000); // 1-second tail
  });

  it("preserves bit-exact samples through round-trip (mono ramp)", () => {
    const wav = makeRampWav({
      channels: 1,
      sampleRate: 48000,
      bitDepth: "16",
      durationSeconds: 6,
    });
    const result = collectChunks(
      splitWavFile(wav, { mode: "preserve", chunkSeconds: 5 }),
    );

    expect(result.chunks.length).toBe(2);
    const originalSamples = readSamplesPerChannel(wav).samples[0];
    if (!originalSamples) throw new Error("no source samples");

    let offset = 0;
    for (const chunk of result.chunks) {
      const reread = readSamplesPerChannel(chunk.buffer);
      const chSamples = reread.samples[0];
      if (!chSamples) throw new Error("no chunk samples");
      for (let i = 0; i < chSamples.length; i++) {
        expect(chSamples[i]).toBe(originalSamples[offset + i]);
      }
      offset += chSamples.length;
    }
    expect(offset).toBe(originalSamples.length);
  });

  it("rewrites sampleRate to source/10 in expand-10x mode", () => {
    const wav = makeRampWav({
      channels: 1,
      sampleRate: 250000,
      bitDepth: "16",
      durationSeconds: 1,
    });
    const result = collectChunks(
      splitWavFile(wav, { mode: "expand-10x", chunkSeconds: 5 }),
    );

    // Source is 1 s = 250 000 samples. Output rate = 25 000 → chunk = 125 000.
    // 250 000 / 125 000 = 2 chunks exactly.
    expect(result.chunks.length).toBe(2);
    for (const chunk of result.chunks) {
      expect(chunk.outputSampleRate).toBe(25000);
      const reread = readSamplesPerChannel(chunk.buffer);
      expect(reread.sampleRate).toBe(25000);
    }
  });

  it("preserves bit-exact samples in expand-10x mode (header-only change)", () => {
    const wav = makeRampWav({
      channels: 1,
      sampleRate: 250000,
      bitDepth: "16",
      durationSeconds: 1,
    });
    const result = collectChunks(
      splitWavFile(wav, { mode: "expand-10x", chunkSeconds: 5 }),
    );

    const originalSamples = readSamplesPerChannel(wav).samples[0];
    if (!originalSamples) throw new Error("no source samples");

    let offset = 0;
    for (const chunk of result.chunks) {
      const chSamples = readSamplesPerChannel(chunk.buffer).samples[0];
      if (!chSamples) throw new Error("no chunk samples");
      for (let i = 0; i < chSamples.length; i++) {
        expect(chSamples[i]).toBe(originalSamples[offset + i]);
      }
      offset += chSamples.length;
    }
    expect(offset).toBe(originalSamples.length);
  });

  it("keeps channels grouped for stereo 24-bit", () => {
    const wav = makeRampWav({
      channels: 2,
      sampleRate: 48000,
      bitDepth: "24",
      durationSeconds: 6,
    });
    const result = collectChunks(
      splitWavFile(wav, { mode: "preserve", chunkSeconds: 5 }),
    );

    expect(result.chunks.length).toBe(2);
    for (const chunk of result.chunks) {
      const reread = readSamplesPerChannel(chunk.buffer);
      expect(reread.channels).toBe(2);
      expect(reread.bitDepth).toBe("24");
      expect(reread.samples.length).toBe(2);
      // Verify channels differ (ramp uses (c+1) factor, so ch1 != ch0).
      const ch0 = reread.samples[0];
      const ch1 = reread.samples[1];
      if (!ch0 || !ch1) throw new Error("missing channel");
      let differCount = 0;
      for (let i = 0; i < Math.min(100, ch0.length); i++) {
        if (ch0[i] !== ch1[i]) differCount += 1;
      }
      expect(differCount).toBeGreaterThan(50);
    }
  });

  it("aborts before the first chunk if signal is already aborted", () => {
    const wav = makeRampWav({ durationSeconds: 10 });
    const controller = new AbortController();
    controller.abort();

    const result = collectChunks(
      splitWavFile(wav, {
        mode: "preserve",
        chunkSeconds: 5,
        signal: controller.signal,
      }),
    );

    expect(result.aborted).toBe(true);
    expect(result.chunks).toEqual([]);
  });

  it("aborts between chunks when signal fires mid-iteration", () => {
    const wav = makeRampWav({
      channels: 1,
      sampleRate: 48000,
      bitDepth: "16",
      durationSeconds: 30, // many chunks expected
    });
    const controller = new AbortController();
    let count = 0;
    let aborted = false;

    for (const y of splitWavFile(wav, {
      mode: "preserve",
      chunkSeconds: 5,
      signal: controller.signal,
    })) {
      if (y.kind === "chunk") {
        count += 1;
        if (count === 2) controller.abort();
      }
      if (y.kind === "abort") aborted = true;
    }

    expect(aborted).toBe(true);
    expect(count).toBe(2);
  });
});
