import type {
  ProcessInput,
  ProcessOutcome,
  ProgressEvent,
} from "../../types.js";
import { run as runPool } from "./splitWorkerPool.js";
import type { WriteFsLike } from "../fs/safeFsOps.js";

export type ProcessOptions = {
  signal?: AbortSignal;
  fs?: WriteFsLike;
  /** Hard cap per source file. Defaults to 500 MB. */
  maxInputBytes?: number;
  onProgress?: (event: ProgressEvent) => void;
};

/**
 * Processes a list of WAV files: splits each into 5-second chunks
 * (in the OUTPUT timeline) and writes them to `<dir>/processed/`.
 *
 * Strictly non-destructive: source files are only read. All writes go to the
 * processed/ subfolder, via atomic .tmp + rename.
 *
 * Files matching `_NNN.wav` are skipped (likely already-produced chunks) and
 * recorded in `skippedAlreadyChunked`. Files exceeding `maxInputBytes` are
 * recorded in `skippedTooLarge`. Other I/O or format errors are recorded
 * per-file in `errored` without stopping the batch.
 *
 * AbortSignal: checked between files and between chunks of the same file.
 */
export const processWavFiles = async (
  files: string[],
  dir: string,
  input: ProcessInput,
  options?: ProcessOptions,
): Promise<ProcessOutcome> => {
  return runPool(files, dir, input, {
    signal: options?.signal,
    maxInputBytes: options?.maxInputBytes,
    onProgress: options?.onProgress,
  });
};
