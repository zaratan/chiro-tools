import path from "node:path";
import { readFile } from "node:fs/promises";
import { WaveFile } from "wavefile";
import { splitWavFile } from "./splitWavFile.js";
import type { ProcessInput } from "../../types.js";
import { CHUNK_OUTPUT_SECONDS } from "./constants.js";
import { buildChunkName } from "./batchPlan.js";
const SPOT_CHECK_SAMPLE_COUNT = 100;

/**
 * Byte-identity check between what sox produced and what the wavefile
 * pipeline would have produced.
 *
 * Its own module, mirroring `verifyZipArchive` next to `createZipArchive`:
 * this is the *verification* half of the fast path, and it is the only
 * reason the fast path may be trusted. `soxFastPath.ts` orchestrates a
 * batch; this decides whether that batch may be published.
 *
 * Deliberately a *spot* check — the first, middle and last chunk, and only
 * the middle SPOT_CHECK_SAMPLE_COUNT samples of each. A corruption near a
 * chunk's start slips through; that is the accepted cost of running this
 * after every batch rather than a full compare.
 */
const decodeFirstChannelSamples = (
  buf: Buffer,
): Int16Array | Int32Array | null => {
  let wav: WaveFile;
  try {
    wav = new WaveFile(buf);
  } catch {
    return null;
  }
  const Ctor: typeof Int16Array | typeof Int32Array =
    wav.bitDepth === "16" ? Int16Array : Int32Array;
  const raw = wav.getSamples(false, Ctor) as unknown as
    Int16Array | Int32Array | (Int16Array | Int32Array)[];
  const samples: (Int16Array | Int32Array)[] = Array.isArray(raw) ? raw : [raw];
  return samples[0] ?? null;
};

const middleSamplesFingerprint = (channel: Int16Array | Int32Array): string => {
  const total = channel.length;
  const midStart =
    Math.floor(total / 2) - Math.floor(SPOT_CHECK_SAMPLE_COUNT / 2);
  const start = Math.max(0, midStart);
  const end = Math.min(total, start + SPOT_CHECK_SAMPLE_COUNT);
  return Array.from(channel.subarray(start, end)).join(",");
};

const fingerprintChunkMiddle = async (
  chunkPath: string,
): Promise<string | null> => {
  let buf: Buffer;
  try {
    buf = await readFile(chunkPath);
  } catch {
    return null;
  }
  const channel = decodeFirstChannelSamples(buf);
  if (channel === null || channel.length === 0) return null;
  return middleSamplesFingerprint(channel);
};

// Fingerprints several reference chunks in a single traversal of the
// wavefile generator. Calling fingerprintReferenceChunk once per target
// index would re-decode the source and re-encode every chunk up to the
// target for each call — exactly the CPU cost the sox fast path exists to
// avoid. Returns a map from target index to its fingerprint (or null if
// the chunk could not be decoded); indices the generator never reaches
// (aborted/errored/out of range) are simply absent from the map.
const fingerprintReferenceChunks = (
  sourceBuffer: Buffer,
  mode: ProcessInput["mode"],
  targetIndices: number[],
): Map<number, string | null> => {
  const targets = new Set(targetIndices);
  const maxTarget = Math.max(...targetIndices);
  const results = new Map<number, string | null>();

  for (const yielded of splitWavFile(sourceBuffer, {
    mode,
    chunkSeconds: CHUNK_OUTPUT_SECONDS,
  })) {
    if (yielded.kind !== "chunk") break;
    const { chunk } = yielded;
    if (chunk.index > maxTarget) break;
    if (!targets.has(chunk.index)) continue;

    const channel = decodeFirstChannelSamples(Buffer.from(chunk.buffer));
    results.set(
      chunk.index,
      channel === null || channel.length === 0
        ? null
        : middleSamplesFingerprint(channel),
    );

    if (results.size === targets.size) break;
  }

  return results;
};

// Lists sox-produced raw files in numerical order

export const runSpotCheck = async (
  sourceBuffer: Buffer,
  outDir: string,
  baseName: string,
  chunkCount: number,
  mode: ProcessInput["mode"],
): Promise<string | null> => {
  if (chunkCount === 0) return "spot-check: no chunks produced";

  const checkIndices = [0, Math.floor(chunkCount / 2), chunkCount - 1].filter(
    (v, i, arr) => arr.indexOf(v) === i,
  );

  const refFingerprints = fingerprintReferenceChunks(
    sourceBuffer,
    mode,
    checkIndices,
  );

  for (const idx of checkIndices) {
    const chunkPath = path.join(outDir, buildChunkName(baseName, idx));

    const soxFingerprint = await fingerprintChunkMiddle(chunkPath);
    if (soxFingerprint === null) {
      return `spot-check: could not decode chunk ${String(idx)}`;
    }

    const refFingerprint = refFingerprints.get(idx) ?? null;
    if (refFingerprint === null) {
      return `spot-check: could not decode reference chunk ${String(idx)}`;
    }

    if (soxFingerprint !== refFingerprint) {
      return `spot-check mismatch on chunk ${String(idx)}`;
    }
  }

  return null;
};
