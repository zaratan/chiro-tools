import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkAdmission,
  readWavHeader,
  type WavHeader,
} from "../wavAdmission.js";
import { makeRampBytes, makeWavBytes } from "./fixtures.js";

const chunk = (id: string, payload: Buffer): Buffer => {
  const header = Buffer.alloc(8);
  header.write(id, 0, "ascii");
  header.writeUInt32LE(payload.byteLength, 4);
  return Buffer.concat([header, payload]);
};

const riffOf = (...chunks: Buffer[]): Buffer => {
  const body = Buffer.concat([Buffer.from("WAVE", "ascii"), ...chunks]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.byteLength, 4);
  return Buffer.concat([header, body]);
};

const pcm16MonoFmt = (): Buffer => makeWavBytes().subarray(20, 36);

const extensibleFmtOf18Bytes = (): Buffer => {
  const fmt = Buffer.concat([pcm16MonoFmt(), Buffer.alloc(2)]);
  fmt.writeUInt16LE(0xfffe, 0);
  return fmt;
};

describe("readWavHeader", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-admission-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const readBytes = async (bytes: Buffer): Promise<unknown> => {
    const filePath = path.join(tmpDir, "source.wav");
    await writeFile(filePath, bytes);
    return readWavHeader(filePath);
  };

  it("reads format, channels, rate, bit depth and data size of a plain PCM file", async () => {
    const result = await readBytes(
      makeWavBytes({ channels: 2, sampleRate: 384000, data: makeRampBytes(8) }),
    );

    expect(result).toEqual({
      kind: "ok",
      header: {
        audioFormat: 1,
        subformatTag: null,
        channels: 2,
        sampleRate: 384000,
        bitsPerSample: 16,
        dataBytes: 8,
      },
    });
  });

  it("reads the EXTENSIBLE subformat as the first uint32 of the GUID, as wavefile does", async () => {
    const result = await readBytes(
      makeWavBytes({ extensibleSubformat: 0x00010001, data: makeRampBytes(4) }),
    );

    expect(result).toMatchObject({
      kind: "ok",
      header: { audioFormat: 0xfffe, subformatTag: 0x00010001 },
    });
  });

  it("skips a long JUNK chunk and an odd-sized LIST chunk before the audio without loading them", async () => {
    const result = await readBytes(
      makeWavBytes({
        data: makeRampBytes(6),
        chunksBefore: [
          { id: "JUNK", payload: Buffer.alloc(1024 * 1024) },
          { id: "LIST", payload: Buffer.alloc(13) },
        ],
      }),
    );

    expect(result).toMatchObject({ kind: "ok", header: { dataBytes: 6 } });
  });

  it("reads a header whose declared data size is zero even when audio follows", async () => {
    const result = await readBytes(
      makeWavBytes({ declaredDataSize: 0, trailingBytes: makeRampBytes(64) }),
    );

    expect(result).toMatchObject({ kind: "ok", header: { dataBytes: 0 } });
  });

  it.each([
    ["a file that is not RIFF", Buffer.from("not a wav file at all")],
    ["a RIFF file that is not WAVE", Buffer.from("RIFF\x04\x00\x00\x00AVI ")],
    [
      "an RF64 file",
      Buffer.concat([Buffer.from("RF64"), makeWavBytes().subarray(4)]),
    ],
    ["a header with no data chunk", riffOf(chunk("fmt ", pcm16MonoFmt()))],
    [
      "a data chunk before the fmt chunk",
      riffOf(chunk("data", makeRampBytes(4)), chunk("fmt ", pcm16MonoFmt())),
    ],
    ["a file cut inside a chunk header", makeWavBytes().subarray(0, 40)],
    [
      "a fmt chunk shorter than 16 bytes",
      riffOf(chunk("fmt ", Buffer.alloc(14))),
    ],
    [
      "an EXTENSIBLE fmt chunk shorter than 40 bytes",
      riffOf(
        chunk("fmt ", extensibleFmtOf18Bytes()),
        chunk("data", makeRampBytes(4)),
      ),
    ],
    [
      "a JUNK chunk declaring 4 GiB",
      riffOf(Buffer.from("JUNK\xff\xff\xff\xff", "latin1")),
    ],
    [
      "more than 64 chunks before the data",
      makeWavBytes({
        chunksBefore: Array.from({ length: 64 }, () => ({
          id: "JUNK",
          payload: Buffer.alloc(2),
        })),
      }),
    ],
  ])("returns invalid-header for %s", async (_label, bytes) => {
    expect(await readBytes(bytes)).toEqual({
      kind: "error",
      code: "invalid-header",
    });
  });

  it("accepts exactly 64 chunks before the data", async () => {
    const result = await readBytes(
      makeWavBytes({
        data: makeRampBytes(4),
        chunksBefore: Array.from({ length: 63 }, () => ({
          id: "JUNK",
          payload: Buffer.alloc(2),
        })),
      }),
    );

    expect(result).toMatchObject({ kind: "ok", header: { dataBytes: 4 } });
  });

  it("returns the file system code when the file cannot be opened", async () => {
    expect(await readWavHeader(path.join(tmpDir, "missing.wav"))).toEqual({
      kind: "error",
      code: "ENOENT",
    });
  });
});

describe("checkAdmission", () => {
  const header = (overrides: Partial<WavHeader> = {}): WavHeader => ({
    audioFormat: 1,
    subformatTag: null,
    channels: 1,
    sampleRate: 384000,
    bitsPerSample: 16,
    dataBytes: 1000,
    ...overrides,
  });

  it.each([
    ["PCM 16 bits", header()],
    ["PCM 24 bits", header({ bitsPerSample: 24 })],
    [
      "EXTENSIBLE PCM 16 bits",
      header({ audioFormat: 0xfffe, subformatTag: 1 }),
    ],
    [
      "EXTENSIBLE PCM 24 bits",
      header({ audioFormat: 0xfffe, subformatTag: 1, bitsPerSample: 24 }),
    ],
    ["a single sample frame", header({ dataBytes: 2 })],
  ])("admits %s", (_label, h) => {
    expect(checkAdmission(h)).toBeNull();
  });

  it.each([
    [
      "float32",
      header({ audioFormat: 3, bitsPerSample: 32 }),
      "unsupported-format",
    ],
    [
      "A-law",
      header({ audioFormat: 6, bitsPerSample: 8 }),
      "unsupported-format",
    ],
    [
      "EXTENSIBLE float",
      header({ audioFormat: 0xfffe, subformatTag: 3, bitsPerSample: 32 }),
      "unsupported-format",
    ],
    [
      "an EXTENSIBLE GUID whose first uint16 alone says PCM",
      header({ audioFormat: 0xfffe, subformatTag: 0x00010001 }),
      "unsupported-format",
    ],
    ["PCM 8 bits", header({ bitsPerSample: 8 }), "unsupported-bit-depth"],
    ["PCM 32 bits", header({ bitsPerSample: 32 }), "unsupported-bit-depth"],
    [
      "zero channels",
      header({ channels: 0, audioFormat: 3 }),
      "invalid-header",
    ],
    ["a zero sample rate", header({ sampleRate: 0 }), "invalid-header"],
    ["an empty data chunk", header({ dataBytes: 0 }), "no-samples"],
    ["half a 16-bit sample", header({ dataBytes: 1 }), "no-samples"],
    [
      "a stereo file holding less than one frame, whatever blockAlign claims",
      header({ channels: 2, dataBytes: 2 }),
      "no-samples",
    ],
  ])("refuses %s", (_label, h, code) => {
    expect(checkAdmission(h)).toBe(code);
  });
});
