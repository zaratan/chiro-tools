import { open, type FileHandle } from "node:fs/promises";
import { extractErrorCode } from "../fs/safeFsOps.js";
import {
  checkSplittable,
  EXTENSIBLE_AUDIO_FORMAT,
  type SplitErrorCode,
} from "./wavFormat.js";

export type WavHeader = {
  audioFormat: number;
  subformatTag: number | null;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  dataBytes: number;
};

export type WavHeaderResult =
  { kind: "ok"; header: WavHeader } | { kind: "error"; code: string };

type WavFmt = Omit<WavHeader, "dataBytes">;

const MAX_CHUNKS_BEFORE_DATA = 64;
const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const MIN_FMT_BYTES = 16;
const EXTENSIBLE_FMT_BYTES = 40;
const PREFETCH_BYTES = 4096;

const INVALID_HEADER: WavHeaderResult = {
  kind: "error",
  code: "invalid-header",
};

const readExactly = async (
  fh: FileHandle,
  length: number,
  position: number,
): Promise<Buffer | null> => {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buffer, 0, length, position);
  return bytesRead === length ? buffer : null;
};

type ReadAt = (length: number, position: number) => Promise<Buffer | null>;

const prefetchingReader = async (fh: FileHandle): Promise<ReadAt> => {
  const head = Buffer.alloc(PREFETCH_BYTES);
  const { bytesRead } = await fh.read(head, 0, PREFETCH_BYTES, 0);
  return (length, position) =>
    position + length <= bytesRead
      ? Promise.resolve(head.subarray(position, position + length))
      : readExactly(fh, length, position);
};

const parseFmt = (payload: Buffer): WavFmt | null => {
  const audioFormat = payload.readUInt16LE(0);
  const isExtensible = audioFormat === EXTENSIBLE_AUDIO_FORMAT;
  if (isExtensible && payload.byteLength < EXTENSIBLE_FMT_BYTES) return null;
  return {
    audioFormat,
    subformatTag: isExtensible ? payload.readUInt32LE(24) : null,
    channels: payload.readUInt16LE(2),
    sampleRate: payload.readUInt32LE(4),
    bitsPerSample: payload.readUInt16LE(14),
  };
};

const walkChunks = async (fh: FileHandle): Promise<WavHeaderResult> => {
  const readAt = await prefetchingReader(fh);
  const riff = await readAt(RIFF_HEADER_BYTES, 0);
  if (
    riff?.toString("ascii", 0, 4) !== "RIFF" ||
    riff.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return INVALID_HEADER;
  }

  let position = RIFF_HEADER_BYTES;
  let fmt: WavFmt | null = null;
  for (let i = 0; i <= MAX_CHUNKS_BEFORE_DATA; i++) {
    const chunkHeader = await readAt(CHUNK_HEADER_BYTES, position);
    if (chunkHeader === null) return INVALID_HEADER;
    const id = chunkHeader.toString("ascii", 0, 4);
    const size = chunkHeader.readUInt32LE(4);

    if (id === "fmt ") {
      if (size < MIN_FMT_BYTES) return INVALID_HEADER;
      const payload = await readAt(
        Math.min(size, EXTENSIBLE_FMT_BYTES),
        position + CHUNK_HEADER_BYTES,
      );
      fmt = payload === null ? null : parseFmt(payload);
      if (fmt === null) return INVALID_HEADER;
    } else if (id === "data") {
      if (fmt === null) return INVALID_HEADER;
      return { kind: "ok", header: { ...fmt, dataBytes: size } };
    }

    position += CHUNK_HEADER_BYTES + size + (size % 2);
  }
  return INVALID_HEADER;
};

export const readWavHeader = async (
  absPath: string,
): Promise<WavHeaderResult> => {
  let fh: FileHandle;
  try {
    fh = await open(absPath, "r");
  } catch (err) {
    return { kind: "error", code: extractErrorCode(err) };
  }
  try {
    return await walkChunks(fh);
  } catch (err) {
    return { kind: "error", code: extractErrorCode(err) };
  } finally {
    await fh.close().catch(() => undefined);
  }
};

export const checkAdmission = (header: WavHeader): SplitErrorCode | null => {
  if (header.channels === 0 || header.sampleRate === 0) {
    return "invalid-header";
  }
  const formatError = checkSplittable(header);
  if (formatError !== null) return formatError;
  const frameBytes = (header.channels * header.bitsPerSample) / 8;
  return header.dataBytes < frameBytes ? "no-samples" : null;
};
