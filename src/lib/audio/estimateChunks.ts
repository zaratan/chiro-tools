import type { ProcessInput } from "../../types.js";
import { buildQueue, DEFAULT_MAX_INPUT_BYTES } from "./batchPlan.js";
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
 *
 * Admission mirrors `buildQueue` — the same function the real run uses to
 * decide what gets processed — so already-chunked `_NNN.wav` files and
 * files over `DEFAULT_MAX_INPUT_BYTES` are excluded from the estimate the
 * same way they're excluded from the run. Without this, the preview counted
 * files the run then skips, so the bar could never reach 100 %.
 *
 * `buildQueue` does not take an `AbortSignal` (a single stat pass per file,
 * not interruptible mid-flight) — the abort check below only covers the
 * "already aborted before we start" case, which is what the caller
 * (progress bar sizing, aborted on unmount) actually needs.
 */
export const estimateChunkCount = async (
  wavFiles: string[],
  cwd: string,
  mode: ProcessInput["mode"],
  signal?: AbortSignal,
): Promise<ChunkEstimate> => {
  if (isAborted(signal)) {
    return { totalChunks: 0, totalDurationSec: 0, totalBytes: 0 };
  }

  const outputRate =
    mode === "preserve" ? PRESERVE_MODE_OUTPUT_RATE : EXPAND_MODE_OUTPUT_RATE;
  const samplesPerChunk = outputRate * CHUNK_OUTPUT_SECONDS;

  const { queue } = await buildQueue(wavFiles, cwd, DEFAULT_MAX_INPUT_BYTES);

  let totalSamples = 0;
  let totalBytes = 0;
  let totalChunks = 0;

  for (const item of queue) {
    totalBytes += item.fileSizeBytes;
    const fileSamples = Math.floor(
      item.fileSizeBytes / BYTES_PER_SAMPLE_16BIT_MONO,
    );
    totalSamples += fileSamples;
    totalChunks += Math.ceil(fileSamples / samplesPerChunk);
  }

  const totalDurationSec = totalSamples / outputRate;
  return { totalChunks, totalDurationSec, totalBytes };
};
