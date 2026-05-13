import { describe, expect, it } from "vitest";
import { buildChunkMeta, type ChunkMetaInput } from "../chunkMetadata.js";

const baseInput = (
  overrides: Partial<ChunkMetaInput> = {},
): ChunkMetaInput => ({
  sourceTimestamp: new Date(2026, 4, 7, 21, 10, 0),
  chunkIndex: 0,
  chunkSamples: 38400 * 50,
  outputSampleRate: 38400,
  timeExpansion: 10,
  originalFilename:
    "Car340581-2026-Pass1-Z5-PaRecPR1925645_20260507_211006.wav",
  chiroVersion: "0.1.2",
  ...overrides,
});

describe("buildChunkMeta", () => {
  it("yields 5 s real-time Length for a full 50 s output chunk @ TE×10", () => {
    const { guano, wamd } = buildChunkMeta(baseInput());
    expect(guano.lengthSeconds).toBe(5);
    // wamd does not carry length, sanity-check it exists.
    expect(wamd.timeExpansion).toBe(10);
  });

  it("computes real sample rate as outputSR × timeExpansion (Teensy preserve)", () => {
    const { guano } = buildChunkMeta(baseInput({ outputSampleRate: 38400 }));
    expect(guano.realSampleRate).toBe(384000);
  });

  it("computes real sample rate for AudioMoth expand-10x output (25 kHz → 250 kHz real)", () => {
    const { guano } = buildChunkMeta(
      baseInput({ outputSampleRate: 25000, chunkSamples: 25000 * 50 }),
    );
    expect(guano.realSampleRate).toBe(250000);
    expect(guano.lengthSeconds).toBe(5);
  });

  it("shifts the chunk timestamp by chunkIndex × 5 s real-time", () => {
    const { guano, wamd } = buildChunkMeta(baseInput({ chunkIndex: 3 }));
    expect(guano.timestamp).not.toBeNull();
    if (guano.timestamp === null) throw new Error("ts null");
    expect(guano.timestamp.getTime()).toBe(
      new Date(2026, 4, 7, 21, 10, 15).getTime(),
    );
    // wamd shares the same shifted timestamp.
    expect(wamd.timestamp?.getTime()).toBe(guano.timestamp.getTime());
  });

  it("yields a partial Length for a tail chunk", () => {
    // Half a full chunk = 25 s output = 2.5 s real-time.
    const { guano } = buildChunkMeta(
      baseInput({ chunkSamples: 38400 * 25, chunkIndex: 1 }),
    );
    expect(guano.lengthSeconds).toBe(2.5);
  });

  it("propagates null source timestamp to both GUANO and wamd", () => {
    const { guano, wamd } = buildChunkMeta(
      baseInput({ sourceTimestamp: null, chunkIndex: 2 }),
    );
    expect(guano.timestamp).toBeNull();
    expect(wamd.timestamp).toBeNull();
  });

  it("composes the wamd Software field from the chiro version", () => {
    const { wamd } = buildChunkMeta(baseInput({ chiroVersion: "9.8.7" }));
    expect(wamd.software).toBe("chiro 9.8.7");
  });
});
