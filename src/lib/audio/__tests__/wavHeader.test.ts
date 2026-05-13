import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WaveFile } from "wavefile";
import { rewriteHeaderToStandardPcm } from "../wavHeader.js";
import { makeRampWav } from "./fixtures.js";

describe("rewriteHeaderToStandardPcm", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-wavheader-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const writeTmp = async (name: string, data: Uint8Array): Promise<string> => {
    const filePath = path.join(tmpDir, name);
    await writeFile(filePath, data);
    return filePath;
  };

  const readWavHeader = (
    buf: Buffer,
  ): {
    audioFormat: number;
    channels: number;
    sampleRate: number;
    byteRate: number;
    blockAlign: number;
    bitsPerSample: number;
    dataSize: number;
  } => {
    return {
      audioFormat: buf.readUInt16LE(20),
      channels: buf.readUInt16LE(22),
      sampleRate: buf.readUInt32LE(24),
      byteRate: buf.readUInt32LE(28),
      blockAlign: buf.readUInt16LE(32),
      bitsPerSample: buf.readUInt16LE(34),
      dataSize: buf.readUInt32LE(40),
    };
  };

  it("produces a 44-byte canonical header for a 16-bit mono WAV (preserve)", async () => {
    const source = makeRampWav({
      channels: 1,
      sampleRate: 48000,
      bitDepth: "16",
      durationSeconds: 1,
    });
    const filePath = await writeTmp("mono16.wav", source);

    await rewriteHeaderToStandardPcm(filePath, false);

    const result = await readFile(filePath);
    expect(result.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(result.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(result.subarray(12, 16).toString("ascii")).toBe("fmt ");
    expect(result.readUInt32LE(16)).toBe(16);
    expect(result.subarray(36, 40).toString("ascii")).toBe("data");
    expect(result.length).toBe(44 + result.readUInt32LE(40));

    const hdr = readWavHeader(result);
    expect(hdr.audioFormat).toBe(1);
    expect(hdr.channels).toBe(1);
    expect(hdr.sampleRate).toBe(48000);
    expect(hdr.bitsPerSample).toBe(16);
    expect(hdr.byteRate).toBe(48000 * 1 * 2);
    expect(hdr.blockAlign).toBe(2);
  });

  it("preserves samples bit-identically for 16-bit mono (preserve)", async () => {
    const source = makeRampWav({
      channels: 1,
      sampleRate: 48000,
      bitDepth: "16",
      durationSeconds: 1,
    });
    const filePath = await writeTmp("mono16.wav", source);

    await rewriteHeaderToStandardPcm(filePath, false);

    const result = await readFile(filePath);
    const wav = new WaveFile(result);
    const fmt = wav.fmt as { numChannels: number; sampleRate: number };
    const raw = wav.getSamples(false, Int16Array) as unknown as
      | Int16Array
      | Int16Array[];
    const samples: Int16Array[] = Array.isArray(raw) ? raw : [raw];

    const originalWav = new WaveFile(source);
    const originalRaw = originalWav.getSamples(false, Int16Array) as unknown as
      | Int16Array
      | Int16Array[];
    const originalSamples: Int16Array[] = Array.isArray(originalRaw)
      ? originalRaw
      : [originalRaw];

    expect(fmt.numChannels).toBe(1);
    expect(fmt.sampleRate).toBe(48000);
    expect(samples.length).toBe(originalSamples.length);

    const ch0 = samples[0];
    const origCh0 = originalSamples[0];
    if (!ch0 || !origCh0) throw new Error("missing channel data");
    expect(Array.from(ch0)).toEqual(Array.from(origCh0));
  });

  it("produces canonical header for 24-bit stereo (preserve)", async () => {
    const source = makeRampWav({
      channels: 2,
      sampleRate: 48000,
      bitDepth: "24",
      durationSeconds: 1,
    });
    const filePath = await writeTmp("stereo24.wav", source);

    await rewriteHeaderToStandardPcm(filePath, false);

    const result = await readFile(filePath);
    const hdr = readWavHeader(result);

    expect(hdr.audioFormat).toBe(1);
    expect(hdr.channels).toBe(2);
    expect(hdr.sampleRate).toBe(48000);
    expect(hdr.bitsPerSample).toBe(24);
    expect(hdr.byteRate).toBe(48000 * 2 * 3);
    expect(hdr.blockAlign).toBe(6);
    expect(result.length).toBe(44 + hdr.dataSize);
  });

  it("preserves samples bit-identically for 24-bit stereo (preserve)", async () => {
    const source = makeRampWav({
      channels: 2,
      sampleRate: 48000,
      bitDepth: "24",
      durationSeconds: 1,
    });
    const filePath = await writeTmp("stereo24.wav", source);

    await rewriteHeaderToStandardPcm(filePath, false);

    const result = await readFile(filePath);
    const wav = new WaveFile(result);
    const raw = wav.getSamples(false, Int32Array) as unknown as
      | Int32Array
      | Int32Array[];
    const samples: Int32Array[] = Array.isArray(raw) ? raw : [raw];

    const originalWav = new WaveFile(source);
    const originalRaw = originalWav.getSamples(false, Int32Array) as unknown as
      | Int32Array
      | Int32Array[];
    const originalSamples: Int32Array[] = Array.isArray(originalRaw)
      ? originalRaw
      : [originalRaw];

    expect(samples.length).toBe(2);
    for (let c = 0; c < 2; c++) {
      const ch = samples[c];
      const origCh = originalSamples[c];
      if (!ch || !origCh) throw new Error(`missing channel ${String(c)}`);
      expect(Array.from(ch)).toEqual(Array.from(origCh));
    }
  });

  it("divides sampleRate and byteRate by 10 in expand-10x mode", async () => {
    const source = makeRampWav({
      channels: 1,
      sampleRate: 250000,
      bitDepth: "16",
      durationSeconds: 1,
    });
    const filePath = await writeTmp("expand.wav", source);

    await rewriteHeaderToStandardPcm(filePath, true);

    const result = await readFile(filePath);
    const hdr = readWavHeader(result);

    expect(hdr.sampleRate).toBe(25000);
    expect(hdr.byteRate).toBe(25000 * 1 * 2);
    expect(hdr.audioFormat).toBe(1);
  });

  it("strips LIST/INFO/ICMT chunks between fmt and data", async () => {
    const rampWav = makeRampWav({
      channels: 1,
      sampleRate: 48000,
      bitDepth: "16",
      durationSeconds: 1,
    });

    // Inject a fake LIST chunk between fmt and data
    const originalBuf = Buffer.from(rampWav);
    // Find where data chunk starts (after 12 bytes RIFF header + fmt chunk)
    // Standard wavefile output: RIFF(4) + size(4) + WAVE(4) + fmt (4) + size(4) + 16bytes + data(4) + size(4) + ...
    // = byte 44 is start of data chunk id
    const fakeList = Buffer.from("LIST\x10\x00\x00\x00INFOtest    data    ");
    const listSize = 8 + fakeList.readUInt32LE(4);

    // Insert LIST chunk before data (at offset 36)
    const withList = Buffer.concat([
      originalBuf.subarray(0, 36),
      fakeList.subarray(0, listSize),
      originalBuf.subarray(36),
    ]);
    // Update RIFF size
    withList.writeUInt32LE(withList.length - 8, 4);

    const filePath = await writeTmp("with-list.wav", withList);

    await rewriteHeaderToStandardPcm(filePath, false);

    const result = await readFile(filePath);
    expect(result.subarray(36, 40).toString("ascii")).toBe("data");
    expect(result.length).toBe(44 + result.readUInt32LE(40));
    const hdr = readWavHeader(result);
    expect(hdr.audioFormat).toBe(1);
  });

  it("strips JUNK and fact chunks between fmt and data", async () => {
    const rampWav = makeRampWav({
      channels: 1,
      sampleRate: 48000,
      bitDepth: "16",
      durationSeconds: 1,
    });
    const originalBuf = Buffer.from(rampWav);

    // JUNK chunk: 12 bytes of padding
    const junkPayload = Buffer.alloc(12, 0);
    const junkChunk = Buffer.alloc(8 + 12);
    junkChunk.write("JUNK", 0);
    junkChunk.writeUInt32LE(12, 4);
    junkPayload.copy(junkChunk, 8);

    const withJunk = Buffer.concat([
      originalBuf.subarray(0, 36),
      junkChunk,
      originalBuf.subarray(36),
    ]);
    withJunk.writeUInt32LE(withJunk.length - 8, 4);

    const filePath = await writeTmp("with-junk.wav", withJunk);

    await rewriteHeaderToStandardPcm(filePath, false);

    const result = await readFile(filePath);
    expect(result.subarray(36, 40).toString("ascii")).toBe("data");
    expect(result.length).toBe(44 + result.readUInt32LE(40));
  });

  it("handles audioFormat 0xfffe (EXTENSIBLE) and outputs audioFormat=1", async () => {
    // Manually build a WAVE_FORMAT_EXTENSIBLE WAV
    const sampleRate = 48000;
    const channels = 1;
    const bitsPerSample = 16;
    const sampleCount = sampleRate;
    const samples = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) samples[i] = i % 1000;

    const dataBytes = samples.byteLength;
    // fmt chunk for EXTENSIBLE is 40 bytes (cbSize=22 + SubFormat GUID)
    const fmtSize = 40;
    const totalSize = 4 + 8 + fmtSize + 8 + dataBytes;
    const buf = Buffer.alloc(8 + totalSize);

    buf.write("RIFF", 0);
    buf.writeUInt32LE(totalSize, 4);
    buf.write("WAVE", 8);
    buf.write("fmt ", 12);
    buf.writeUInt32LE(fmtSize, 16);
    buf.writeUInt16LE(0xfffe, 20); // WAVE_FORMAT_EXTENSIBLE
    buf.writeUInt16LE(channels, 22);
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
    buf.writeUInt16LE(channels * (bitsPerSample / 8), 32);
    buf.writeUInt16LE(bitsPerSample, 34);
    buf.writeUInt16LE(22, 36); // cbSize
    buf.writeUInt16LE(bitsPerSample, 38); // wValidBitsPerSample
    buf.writeUInt32LE(0, 40); // dwChannelMask
    // SubFormat GUID: PCM = {00000001-0000-0010-8000-00aa00389b71}
    buf.writeUInt16LE(0x0001, 44); // SubFormat[0] = PCM
    buf.writeUInt16LE(0x0000, 46);
    buf.writeUInt16LE(0x0010, 48);
    buf.writeUInt16LE(0x8000, 50);
    // remaining 6 bytes of GUID
    buf.write("\x00\xaa\x00\x38\x9b\x71", 52, "binary");
    buf.write("data", 60);
    buf.writeUInt32LE(dataBytes, 64);
    Buffer.from(samples.buffer).copy(buf, 68);

    const filePath = await writeTmp("extensible.wav", buf);

    await rewriteHeaderToStandardPcm(filePath, false);

    const result = await readFile(filePath);
    const hdr = readWavHeader(result);

    expect(hdr.audioFormat).toBe(1);
    expect(hdr.sampleRate).toBe(sampleRate);
    expect(result.length).toBe(44 + dataBytes);
  });
});
