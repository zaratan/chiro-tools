import type {
  ProcessInput,
  ProcessOutcome,
  ProgressEvent,
} from "../../types.js";
import { run as runPool } from "./splitWorkerPool.js";
import { runSoxBatch } from "./soxFastPath.js";
import type { WriteFsLike } from "../fs/safeFsOps.js";

export type SoxContext = { binPath: string };

export type ProcessOptions = {
  signal?: AbortSignal;
  fs?: WriteFsLike;
  /** Hard cap per source file. Defaults to 500 MB. */
  maxInputBytes?: number;
  onProgress?: (event: ProgressEvent) => void;
  /** If provided, uses the sox fast path with fallback to worker pool. */
  sox?: SoxContext;
};

export type ProcessResult = ProcessOutcome & {
  engine: "wavefile" | "sox";
  engine_fallback_count: number;
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
 *
 * If `options.sox` is provided, attempts the sox fast path first. Fallback to
 * the worker pool is only triggered if sox fails OR spot-check mismatches on
 * the FIRST file (first-file-only policy). Once the first file has validated
 * the sox pipeline, subsequent per-file errors are recorded in `errored` and
 * the batch continues — re-running through wavefile would waste work on the
 * N-1 already-completed files and risk duplicate output.
 */
export const processWavFiles = async (
  files: string[],
  dir: string,
  input: ProcessInput,
  options?: ProcessOptions,
): Promise<ProcessResult> => {
  const poolOptions = {
    signal: options?.signal,
    maxInputBytes: options?.maxInputBytes,
    onProgress: options?.onProgress,
  };

  if (options?.sox) {
    const soxResult = await runSoxBatch(
      options.sox.binPath,
      files,
      dir,
      input,
      poolOptions,
    );

    if (soxResult.kind === "completed") {
      return {
        ...soxResult.outcome,
        engine: "sox",
        engine_fallback_count: 0,
      };
    }

    // Fallback: run the full batch via worker pool
    const poolOutcome = await runPool(files, dir, input, poolOptions);
    return {
      ...poolOutcome,
      engine: "wavefile",
      engine_fallback_count: 1,
    };
  }

  const outcome = await runPool(files, dir, input, poolOptions);
  return { ...outcome, engine: "wavefile", engine_fallback_count: 0 };
};
