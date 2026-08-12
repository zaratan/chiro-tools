import { stat } from "node:fs/promises";
import path from "node:path";
import type { ProcessInput } from "../../types.js";
import {
  CHUNK_OUTPUT_SECONDS,
  EXPAND_MODE_OUTPUT_RATE,
  PRESERVE_MODE_OUTPUT_RATE,
} from "./constants.js";

const BYTES_PER_SAMPLE_16BIT_MONO = 2;

export type ChunkEstimate = {
  totalChunks: number;
  totalDurationSec: number;
  totalBytes: number;
};

const isAborted = (signal?: AbortSignal): boolean => signal?.aborted === true;

/**
 * Best-effort estimation based on file size, used to size the progress bar
 * before processing starts. We assume 16-bit PCM mono (the format used by
 * Teensy/AudioMoth/SM* in Vigie-Chiro) — stereo files would overestimate
 * chunks by 2×, acceptable for an approximate preview.
 *
 * The chunk count is ceiled PER FILE, not globally: the real splitters
 * (`splitWavFile`) start a new chunk for any file with at least one sample,
 * so summing per-file ceilings matches production behaviour. A single
 * global division across the combined sample count can under-count —
 * several files just over a chunk boundary each need an extra chunk, which
 * a global sum masks.
 */
export const estimateChunkCount = async (
  wavFiles: string[],
  cwd: string,
  mode: ProcessInput["mode"],
  signal?: AbortSignal,
): Promise<ChunkEstimate> => {
  const outputRate =
    mode === "preserve" ? PRESERVE_MODE_OUTPUT_RATE : EXPAND_MODE_OUTPUT_RATE;
  const samplesPerChunk = outputRate * CHUNK_OUTPUT_SECONDS;

  let totalSamples = 0;
  let totalBytes = 0;
  let totalChunks = 0;

  for (const name of wavFiles) {
    if (isAborted(signal)) break;
    try {
      const stats = await stat(path.join(cwd, name));
      totalBytes += stats.size;
      const fileSamples = Math.floor(stats.size / BYTES_PER_SAMPLE_16BIT_MONO);
      totalSamples += fileSamples;
      totalChunks += Math.ceil(fileSamples / samplesPerChunk);
    } catch {
      // Ignore — best effort.
    }
  }

  const totalDurationSec = totalSamples / outputRate;
  return { totalChunks, totalDurationSec, totalBytes };
};
