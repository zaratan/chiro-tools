import { mkdir, readFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type {
  ProcessError,
  ProcessInput,
  ProcessOutcome,
  ProcessedFile,
} from "../../types.js";
import {
  extractErrorCode,
  writeFileAtomic,
  type WriteFsLike,
} from "../fs/safeFsOps.js";
import {
  splitWavFile,
  type EncodedChunk,
  type SplitErrorCode,
} from "./splitWavFile.js";

export type ProcessOptions = {
  signal?: AbortSignal;
  fs?: WriteFsLike;
  /** Hard cap per source file. Defaults to 500 MB. */
  maxInputBytes?: number;
};

const DEFAULT_MAX_INPUT_BYTES = 500 * 1024 * 1024;
const PROCESSED_DIRNAME = "processed";
const CHUNK_SECONDS = 5;

// Matches `_NNN.wav` (exactly 3 digits before .wav, case-insensitive on ext).
// Source files that look like chunks we have produced before are skipped to
// avoid silently re-splitting an old run that was moved back into the cwd.
const ALREADY_CHUNKED_REGEX = /_\d{3}\.wav$/i;

const padIndex = (n: number): string => String(n).padStart(3, "0");

const splitErrorReason = (code: SplitErrorCode): string => {
  switch (code) {
    case "invalid-header":
      return "invalid-header";
    case "unsupported-format":
      return "unsupported-format";
    case "unsupported-bit-depth":
      return "unsupported-bit-depth";
    case "no-samples":
      return "no-samples";
  }
};

const preCleanOrphanTmps = async (processedDir: string): Promise<void> => {
  // Orphan tmps can exist after a previous Ctrl+C right before rename.
  // Best-effort cleanup at run start so the new run starts from a clean state.
  let entries: string[];
  try {
    entries = await readdir(processedDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.endsWith(".tmp")) {
      await unlink(path.join(processedDir, entry)).catch(() => undefined);
    }
  }
};

const ensureProcessedDir = async (
  processedDir: string,
): Promise<{ kind: "ok" } | { kind: "error"; code: string }> => {
  try {
    await mkdir(processedDir, { recursive: true });
    return { kind: "ok" };
  } catch (err) {
    return { kind: "error", code: extractErrorCode(err) };
  }
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
 * The current chunk's write cannot be interrupted mid-syscall.
 */
export const processWavFiles = async (
  files: string[],
  dir: string,
  input: ProcessInput,
  options?: ProcessOptions,
): Promise<ProcessOutcome> => {
  const signal = options?.signal;
  const maxInputBytes = options?.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const start = performance.now();
  const processedDir = path.join(dir, PROCESSED_DIRNAME);

  const processed: ProcessedFile[] = [];
  const errored: ProcessError[] = [];
  const skippedTooLarge: string[] = [];
  const skippedAlreadyChunked: string[] = [];
  let interrupted = false;

  const mkdirResult = await ensureProcessedDir(processedDir);
  if (mkdirResult.kind === "error") {
    // If we cannot create the destination, fail every file with the same
    // reason rather than half-process a batch.
    for (const f of files) {
      errored.push({ file: f, reason: `mkdir:${mkdirResult.code}` });
    }
    return {
      processed,
      errored,
      skippedTooLarge,
      skippedAlreadyChunked,
      interrupted,
      durationMs: performance.now() - start,
    };
  }

  await preCleanOrphanTmps(processedDir);

  for (const file of files) {
    if (signal?.aborted === true) {
      interrupted = true;
      break;
    }

    if (ALREADY_CHUNKED_REGEX.test(file)) {
      skippedAlreadyChunked.push(file);
      continue;
    }

    const absSource = path.join(dir, file);

    let size: number;
    try {
      const stats = await stat(absSource);
      size = stats.size;
    } catch (statErr) {
      errored.push({ file, reason: extractErrorCode(statErr) });
      continue;
    }

    if (size > maxInputBytes) {
      skippedTooLarge.push(file);
      continue;
    }

    let buffer: Uint8Array;
    try {
      buffer = await readFile(absSource);
    } catch (readErr) {
      errored.push({ file, reason: extractErrorCode(readErr) });
      continue;
    }

    const baseName = path.parse(file).name;
    let chunkCount = 0;
    let outputSampleRate = 0;
    let channels = 0;
    let fileFailed = false;

    for (const yielded of splitWavFile(buffer, {
      mode: input.mode,
      chunkSeconds: CHUNK_SECONDS,
      signal,
    })) {
      if (yielded.kind === "abort") {
        interrupted = true;
        fileFailed = true;
        break;
      }
      if (yielded.kind === "error") {
        errored.push({ file, reason: splitErrorReason(yielded.code) });
        fileFailed = true;
        break;
      }
      const chunk: EncodedChunk = yielded.chunk;
      const chunkName = `${baseName}_${padIndex(chunk.index)}.wav`;
      const targetPath = path.join(processedDir, chunkName);

      const writeResult = await writeFileAtomic(targetPath, chunk.buffer, {
        signal,
        fs: options?.fs,
      });
      if (writeResult.kind === "error") {
        if (writeResult.code === "ABORT_ERR") {
          interrupted = true;
        } else {
          errored.push({
            file,
            reason: `write:${writeResult.code}`,
          });
        }
        fileFailed = true;
        break;
      }

      chunkCount += 1;
      outputSampleRate = chunk.outputSampleRate;
      channels = chunk.channels;
    }

    if (!fileFailed && chunkCount > 0) {
      processed.push({
        sourceFile: file,
        chunkCount,
        outputSampleRate,
        channels,
      });
    }

    if (interrupted) break;
  }

  return {
    processed,
    errored,
    skippedTooLarge,
    skippedAlreadyChunked,
    interrupted,
    durationMs: performance.now() - start,
  };
};
