import type { ProcessInput } from "../../types.js";
import {
  buildQueue,
  DEFAULT_MAX_INPUT_BYTES,
  type QueuedFile,
} from "./batchPlan.js";
import { CHUNK_OUTPUT_SECONDS, TIME_EXPANSION_FACTOR } from "./constants.js";

export type ChunkEstimate = {
  totalChunks: number;
  totalDurationSec: number;
  totalBytes: number;
};

const isAborted = (signal?: AbortSignal): boolean => signal?.aborted === true;

const estimateFile = (
  item: QueuedFile,
  mode: ProcessInput["mode"],
): { chunks: number; durationSec: number } => {
  const outputRate =
    mode === "expand-10x"
      ? Math.round(item.sampleRate / TIME_EXPANSION_FACTOR)
      : item.sampleRate;
  const samplesPerChunk = Math.floor(outputRate * CHUNK_OUTPUT_SECONDS);
  if (samplesPerChunk <= 0) return { chunks: 0, durationSec: 0 };
  const frameBytes = (item.channels * item.bitsPerSample) / 8;
  const samples = Math.floor(
    Math.min(item.dataBytes, item.fileSizeBytes) / frameBytes,
  );
  return {
    chunks: Math.ceil(samples / samplesPerChunk),
    durationSec: samples / outputRate,
  };
};

/**
 * Admission goes through `buildQueue`, the function the run itself uses, so
 * files the run will skip never count here.
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

  const { queue } = await buildQueue(
    wavFiles,
    cwd,
    DEFAULT_MAX_INPUT_BYTES,
    signal,
  );

  let totalChunks = 0;
  let totalDurationSec = 0;
  let totalBytes = 0;
  for (const item of queue) {
    const { chunks, durationSec } = estimateFile(item, mode);
    totalChunks += chunks;
    totalDurationSec += durationSec;
    totalBytes += item.fileSizeBytes;
  }
  return { totalChunks, totalDurationSec, totalBytes };
};
