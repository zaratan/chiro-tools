import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendAncillaryChunks, finalizeChunk } from "../finalizeChunk.js";
import { makeRampWav } from "./fixtures.js";

const buildSynthChunk = (id: string, payload: Buffer): Buffer => {
  const total = 8 + payload.byteLength;
  const padded = total % 2 === 1;
  const buf = Buffer.alloc(total + (padded ? 1 : 0));
  buf.write(id, 0, "ascii");
  buf.writeUInt32LE(payload.byteLength, 4);
  payload.copy(buf, 8);
  return buf;
};

describe("finalizeChunk", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-finalize-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("without ancillaries: emits a 44-byte canonical PCM header", async () => {
    const filePath = path.join(tmpDir, "no-meta.wav");
    await writeFile(
      filePath,
      makeRampWav({
        channels: 1,
        sampleRate: 48000,
        bitDepth: "16",
        durationSeconds: 1,
      }),
    );

    await finalizeChunk(filePath, { expand10x: false });

    const buf = await readFile(filePath);
    expect(buf.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(buf.subarray(36, 40).toString("ascii")).toBe("data");
    expect(buf.readUInt16LE(20)).toBe(1); // audioFormat = PCM
  });

  it("appends a single ancillary chunk and updates RIFF size", async () => {
    const filePath = path.join(tmpDir, "with-meta.wav");
    await writeFile(
      filePath,
      makeRampWav({
        channels: 1,
        sampleRate: 48000,
        bitDepth: "16",
        durationSeconds: 1,
      }),
    );

    const ancillary = buildSynthChunk("test", Buffer.from("hello", "ascii"));
    await finalizeChunk(filePath, {
      expand10x: false,
      ancillaries: [ancillary],
    });

    const buf = await readFile(filePath);
    const dataSize = buf.readUInt32LE(40);
    const ancillaryStart = 44 + dataSize; // dataSize is even (48000 × 2 bytes)
    expect(
      buf.subarray(ancillaryStart, ancillaryStart + 4).toString("ascii"),
    ).toBe("test");
    expect(buf.readUInt32LE(ancillaryStart + 4)).toBe(5);
    expect(
      buf.subarray(ancillaryStart + 8, ancillaryStart + 13).toString("ascii"),
    ).toBe("hello");

    // RIFF size = total file - 8 (RIFF header)
    expect(buf.readUInt32LE(4)).toBe(buf.byteLength - 8);
  });

  it("appends multiple ancillaries in given order", async () => {
    const filePath = path.join(tmpDir, "multi-meta.wav");
    await writeFile(
      filePath,
      makeRampWav({
        channels: 1,
        sampleRate: 48000,
        bitDepth: "16",
        durationSeconds: 1,
      }),
    );

    const a = buildSynthChunk("aaaa", Buffer.from("first", "ascii"));
    const b = buildSynthChunk("bbbb", Buffer.from("second", "ascii"));
    await finalizeChunk(filePath, {
      expand10x: false,
      ancillaries: [a, b],
    });

    const buf = await readFile(filePath);
    const dataSize = buf.readUInt32LE(40);
    const firstAncStart = 44 + dataSize;
    expect(
      buf.subarray(firstAncStart, firstAncStart + 4).toString("ascii"),
    ).toBe("aaaa");
    const secondAncStart = firstAncStart + a.byteLength;
    expect(
      buf.subarray(secondAncStart, secondAncStart + 4).toString("ascii"),
    ).toBe("bbbb");
  });

  it("appends ancillaries after a 1-byte 0x00 pad when dataSize is odd", async () => {
    // Construct a minimal valid RIFF/fmt/data WAV with odd dataSize.
    // 8-bit PCM lets us have 1-sample-per-byte audio.
    const oddPayload = Buffer.from([0x40, 0x41, 0x42]); // 3 bytes audio
    const filePath = path.join(tmpDir, "odd-data.wav");

    // Build by hand: RIFF (8) + WAVE (4) + fmt chunk (8 + 16) + data chunk (8 + 3).
    const total = 4 + 8 + (8 + 16) + (8 + 3);
    const header = Buffer.alloc(total);
    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(total - 8, 4);
    header.write("WAVE", 8, "ascii");
    header.write("fmt ", 12, "ascii");
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(8000, 24); // sampleRate
    header.writeUInt32LE(8000, 28); // byteRate
    header.writeUInt16LE(1, 32); // blockAlign
    header.writeUInt16LE(8, 34); // 8-bit
    header.write("data", 36, "ascii");
    header.writeUInt32LE(3, 40);
    oddPayload.copy(header, 44);
    await writeFile(filePath, header);

    const ancillary = buildSynthChunk("test", Buffer.from("hi", "ascii"));
    await appendAncillaryChunks(filePath, [ancillary]);

    const buf = await readFile(filePath);
    // dataSize = 3 (odd) → 1 byte 0x00 padding at offset 47, ancillary at 48.
    expect(buf[47]).toBe(0x00);
    expect(buf.subarray(48, 52).toString("ascii")).toBe("test");
    // RIFF size includes pad byte + ancillary.
    expect(buf.readUInt32LE(4)).toBe(buf.byteLength - 8);
  });

  it("noop when ancillaries is empty after rewrite", async () => {
    const filePath = path.join(tmpDir, "empty-anc.wav");
    await writeFile(
      filePath,
      makeRampWav({
        channels: 1,
        sampleRate: 48000,
        bitDepth: "16",
        durationSeconds: 1,
      }),
    );

    const before = await readFile(filePath);
    await finalizeChunk(filePath, { expand10x: false, ancillaries: [] });
    const after = await readFile(filePath);

    expect(Buffer.compare(after, before)).toBe(0);
  });
});
