import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ProcessError, ProgressEvent } from "../../types.js";

// Matches sox/worker-pool output (baseName_NNN.wav) so a batch never
// re-splits its own previous output.
export const ALREADY_CHUNKED_REGEX = /_\d{3}\.wav$/i;

export const DEFAULT_MAX_INPUT_BYTES = 500 * 1024 * 1024;

export const PROCESSED_DIRNAME = "processed";

/** Relative-path form shown to the user in the TUI (e.g. "./processed/"). */
export const PROCESSED_DIR_DISPLAY = `./${PROCESSED_DIRNAME}/`;

export const buildOutDir = (dir: string): string =>
  path.join(dir, PROCESSED_DIRNAME);

// Shared by both pipelines so their output is byte-identically named, and
// stays in lockstep with ALREADY_CHUNKED_REGEX above.
export const buildChunkName = (baseName: string, index: number): string =>
  `${baseName}_${String(index).padStart(3, "0")}.wav`;

const MEMORY_PER_WORKER_MB = 400;
const MEMORY_USABLE_FRACTION = 0.7;
const HARD_CAP = 12;
const MIN_WORKERS = 2;

// Shared concurrency heuristic: both pipelines (sox subprocesses, worker
// threads) size their pool the same way, so this formula is not
// pipeline-specific — clamp between MIN_WORKERS and HARD_CAP, bounded by
// available CPU and RAM.
export const clampWorkerCount = (cpuCount: number, totalMB: number): number => {
  const usableMB = totalMB * MEMORY_USABLE_FRACTION;
  const maxByMemory = Math.floor(usableMB / MEMORY_PER_WORKER_MB);
  const maxByCpu = cpuCount - 1;
  return Math.max(MIN_WORKERS, Math.min(maxByMemory, maxByCpu, HARD_CAP));
};

export const computeConcurrency = (): number => {
  const envOverride = process.env.CHIRO_WORKER_COUNT;
  if (envOverride !== undefined && envOverride !== "") {
    const parsed = parseInt(envOverride, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const cpuCount = os.cpus().length;
  const totalMB = os.totalmem() / (1024 * 1024);
  return clampWorkerCount(cpuCount, totalMB);
};

export const makeEmit = (
  onProgress?: (event: ProgressEvent) => void,
): ((event: ProgressEvent) => void) => {
  if (!onProgress) return (): void => undefined;
  return (event: ProgressEvent): void => {
    try {
      onProgress(event);
    } catch {
      // swallow — a buggy callback must not crash the batch
    }
  };
};

export type QueuedFile = {
  file: string;
  fileIndex: number;
  fileSizeBytes: number;
  absSource: string;
  baseName: string;
};

export type BuildQueueResult = {
  queue: QueuedFile[];
  skippedTooLarge: string[];
  skippedAlreadyChunked: string[];
  errored: ProcessError[];
};

// Admission policy shared by both pipelines: skip already-chunked output,
// stat each remaining source, skip anything over maxInputBytes, and error
// out anything whose stat call fails. fileIndex is assigned by original
// position in `files` (including skipped/errored entries) so progress
// events keep referring to a stable index regardless of admission outcome.
export const buildQueue = async (
  files: string[],
  dir: string,
  maxInputBytes: number,
): Promise<BuildQueueResult> => {
  const result: BuildQueueResult = {
    queue: [],
    skippedTooLarge: [],
    skippedAlreadyChunked: [],
    errored: [],
  };

  let globalFileIndex = 0;

  for (const file of files) {
    const fileIndex = globalFileIndex;
    globalFileIndex += 1;

    if (ALREADY_CHUNKED_REGEX.test(file)) {
      result.skippedAlreadyChunked.push(file);
      continue;
    }

    const absSource = path.join(dir, file);
    let size: number;
    try {
      const stats = await stat(absSource);
      size = stats.size;
    } catch (err) {
      const code =
        err instanceof Error && "code" in err
          ? String((err as { code: unknown }).code)
          : "UNKNOWN";
      result.errored.push({ file, reason: code });
      continue;
    }

    if (size > maxInputBytes) {
      result.skippedTooLarge.push(file);
      continue;
    }

    result.queue.push({
      file,
      fileIndex,
      fileSizeBytes: size,
      absSource,
      baseName: path.parse(file).name,
    });
  }

  return result;
};
