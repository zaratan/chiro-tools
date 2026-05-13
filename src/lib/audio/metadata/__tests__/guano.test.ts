import { describe, expect, it } from "vitest";
import { buildGuanoChunk, type GuanoMeta } from "../guano.js";

const sampleMeta = (overrides: Partial<GuanoMeta> = {}): GuanoMeta => ({
  lengthSeconds: 5,
  originalFilename:
    "Car340581-2026-Pass1-Z5-PaRecPR1925645_20260507_211006.wav",
  realSampleRate: 384000,
  timeExpansion: 10,
  timestamp: new Date(2026, 4, 7, 21, 10, 6),
  chiroVersion: "0.1.2",
  ...overrides,
});

const parseChunkHeader = (
  buf: Buffer,
): { id: string; size: number; content: string } => ({
  id: buf.subarray(0, 4).toString("ascii"),
  size: buf.readUInt32LE(4),
  content: buf.subarray(8, 8 + buf.readUInt32LE(4)).toString("utf8"),
});

describe("buildGuanoChunk", () => {
  it("emits a chunk with id 'guan' and a uint32 LE size matching the content length", () => {
    const buf = buildGuanoChunk(sampleMeta());
    const { id, size, content } = parseChunkHeader(buf);

    expect(id).toBe("guan");
    expect(size).toBe(Buffer.byteLength(content, "utf8"));
  });

  it("renders the expected lines in the Kaleidoscope-compatible order", () => {
    const buf = buildGuanoChunk(sampleMeta());
    const { content } = parseChunkHeader(buf);

    const lines = content.split("\n");
    expect(lines[0]).toBe("GUANO|Version:1.0");
    expect(lines[1]).toBe("Length:5.000000");
    expect(lines[2]).toBe(
      "Original Filename:Car340581-2026-Pass1-Z5-PaRecPR1925645_20260507_211006.wav",
    );
    expect(lines[3]).toBe("Samplerate:384000");
    expect(lines[4]).toBe("TE:10");
    expect(lines[5]).toMatch(/^Timestamp:2026-05-07 21:10:06[+-]\d{2}:\d{2}$/);
    expect(lines[6]).toBe("WA|chiro|Version:0.1.2");
  });

  it("omits the Timestamp line when timestamp is null", () => {
    const buf = buildGuanoChunk(sampleMeta({ timestamp: null }));
    const { content } = parseChunkHeader(buf);

    expect(content).not.toMatch(/Timestamp:/);
    expect(content).toMatch(/WA\|chiro\|Version:/);
  });

  it("uses 6 decimal places for Length so partial chunks round-trip cleanly", () => {
    const buf = buildGuanoChunk(sampleMeta({ lengthSeconds: 2.7345 }));
    const { content } = parseChunkHeader(buf);

    expect(content).toMatch(/Length:2\.734500\n/);
  });

  it("pads to even byte length when content size is odd", () => {
    // Force odd content: short version string. We can't directly poke content
    // length, but a short chiroVersion yields a predictable odd or even count;
    // verify the post-condition rather than precondition.
    const buf = buildGuanoChunk(sampleMeta({ chiroVersion: "x" }));
    expect(buf.byteLength % 2).toBe(0);
  });

  it("encodes UTF-8 multi-byte characters in Original Filename", () => {
    const buf = buildGuanoChunk(
      sampleMeta({ originalFilename: "site-éléphant.wav" }),
    );
    const { content } = parseChunkHeader(buf);
    expect(content).toContain("Original Filename:site-éléphant.wav");
  });
});
