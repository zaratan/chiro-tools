import { mkdir, readFile, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type {
  ProcessError,
  ProcessInput,
  ProcessOutcome,
  ProcessedFile,
  ProgressEvent,
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
  onProgress?: (event: ProgressEvent) => void;
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
  // TS narrowing across async/iteration boundaries thinks signal.aborted
  // cannot flip back to true once we've checked it once. A helper reads
  // the getter fresh at each call site.
  const isAborted = (): boolean => signal?.aborted === true;
  const maxInputBytes = options?.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;

  // Wrap onProgress so a buggy callback never crashes the batch.
  const emit = (event: ProgressEvent): void => {
    if (!options?.onProgress) return;
    try {
      options.onProgress(event);
    } catch (err) {
      if (process.env.CHIRO_DEV === "1") {
        console.error(err);
      }
    }
  };
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

  let fileIndex = 0;
  for (const file of files) {
    if (isAborted()) {
      interrupted = true;
      break;
    }

    if (ALREADY_CHUNKED_REGEX.test(file)) {
      skippedAlreadyChunked.push(file);
      fileIndex += 1;
      continue;
    }

    const absSource = path.join(dir, file);

    let size: number;
    try {
      const stats = await stat(absSource);
      size = stats.size;
    } catch (statErr) {
      errored.push({ file, reason: extractErrorCode(statErr) });
      fileIndex += 1;
      continue;
    }

    if (size > maxInputBytes) {
      skippedTooLarge.push(file);
      fileIndex += 1;
      continue;
    }

    emit({
      kind: "file-start",
      fileIndex,
      fileName: file,
      fileSizeBytes: size,
      totalFiles: files.length,
    });

    let buffer: Uint8Array;
    try {
      buffer = await readFile(absSource);
    } catch (readErr) {
      errored.push({ file, reason: extractErrorCode(readErr) });
      fileIndex += 1;
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
      // Check the signal again before paying for a chunk write — on a large
      // AudioMoth file each chunk encode is ~30-50 ms CPU and the write can
      // be 250-500 KB on disk. Cancelling here saves a guaranteed-discarded
      // write after the user has hit Ctrl+C.
      if (isAborted()) {
        interrupted = true;
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

      emit({ kind: "chunk-written", fileIndex, chunkIndex: chunk.index });

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
      emit({ kind: "file-done", fileIndex, chunkCount, fileSizeBytes: size });
    }

    fileIndex += 1;
    if (interrupted) break;

    // Yield to the macrotask queue between files. The chunk loop above is a
    // tight `await writeFileAtomic` chain producing only microtasks, which
    // starves stdout flushing (Ink's progress repaint backs up and looks
    // glitchy) and prevents the GC from reclaiming the 100-300 MB peak the
    // current file allocated (source buffer + decoded samples + wavefile
    // intermediates). One setImmediate lets I/O callbacks run and gives the
    // GC a stop-the-world window before the next file's allocations begin.
    await new Promise<void>((resolve) => setImmediate(resolve));
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
