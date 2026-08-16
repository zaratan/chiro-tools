import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { runSpotCheck } from "./soxSpotCheck.js";

import { spawn as nodeSpawn } from "node:child_process";
import type {
  ProcessError,
  ProcessInput,
  ProcessOutcome,
  ProcessedFile,
  ProgressEvent,
} from "../../types.js";
import { rewriteHeaderToStandardPcm } from "./wavHeader.js";
import { appendAncillaryChunks } from "./finalizeChunk.js";
import { CHUNK_OUTPUT_SECONDS, TIME_EXPANSION_FACTOR } from "./constants.js";
import { buildChunkMeta } from "./metadata/chunkMetadata.js";
import { buildGuanoChunk } from "./metadata/guano.js";
import { buildWamdChunk } from "./metadata/wamd.js";
import { parseSourceTimestamp } from "../files/parseTimestamp.js";
import { extractErrorCode } from "../fs/safeFsOps.js";
import {
  buildChunkName,
  buildOutDir,
  buildQueue,
  computeConcurrency,
  DEFAULT_MAX_INPUT_BYTES,
  makeEmit,
} from "./batchPlan.js";
import type { MetadataConfig } from "../../types.js";

export type SoxBatchResult =
  | { kind: "completed"; outcome: ProcessOutcome }
  | { kind: "fallback"; reason: string };
const listRawChunks = async (outDir: string): Promise<string[]> => {
  let entries: string[];
  try {
    entries = await readdir(outDir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.startsWith("raw") && f.endsWith(".wav"))
    .sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ""), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ""), 10) || 0;
      return numA - numB;
    });
};

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Cleans up partial sox output for a file — leaves no state on fallback.
// Removes the final chunks (baseName_NNN.wav) and the tmp subdirectory.
//
// The final-chunk match is anchored on `${baseName}_NNN.wav` exactly — a
// plain startsWith would also delete a sibling file whose baseName is a
// strict prefix of this one (e.g. "X_211006" vs "X_211006_Not_Processed").
export const cleanPartialOutput = async (
  outDir: string,
  baseName: string,
): Promise<void> => {
  // Remove the tmp subdirectory if it exists
  const tmpSubDir = path.join(outDir, `.sox-tmp-${baseName}`);
  await rm(tmpSubDir, { recursive: true, force: true }).catch(() => undefined);

  // Remove any final chunks already moved to outDir
  let entries: string[];
  try {
    entries = await readdir(outDir);
  } catch {
    return;
  }
  const finalChunkRegex = new RegExp(
    `^${escapeRegExp(baseName)}_\\d{3}\\.wav$`,
  );
  for (const entry of entries) {
    if (finalChunkRegex.test(entry)) {
      await unlink(path.join(outDir, entry)).catch(() => undefined);
    }
  }
};

// Spawns sox to split a single source file into chunks.
// Uses async spawn to not block the event loop during the split.
const spawnSoxAsync = (
  soxPath: string,
  srcPath: string,
  outputBase: string,
  segmentSeconds: number,
  signal?: AbortSignal,
): Promise<{ exitCode: number | null }> => {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ exitCode: null });
      return;
    }

    const proc = nodeSpawn(
      soxPath,
      [
        srcPath,
        outputBase,
        "trim",
        "0",
        String(segmentSeconds),
        ":",
        "newfile",
        ":",
        "restart",
      ],
      { stdio: "ignore" },
    );

    const onAbort = (): void => {
      proc.kill();
      resolve({ exitCode: null });
    };

    signal?.addEventListener("abort", onAbort, { once: true });

    proc.on("close", (code: number | null) => {
      signal?.removeEventListener("abort", onAbort);
      resolve({ exitCode: code });
    });

    proc.on("error", () => {
      signal?.removeEventListener("abort", onAbort);
      resolve({ exitCode: null });
    });
  });
};

type ProcessOneFileResult =
  | {
      kind: "ok";
      processed: ProcessedFile;
      chunkCount: number;
    }
  | { kind: "error"; reason: string }
  | { kind: "aborted" };

const processOneFile = async (
  soxPath: string,
  file: string,
  dir: string,
  outDir: string,
  input: ProcessInput,
  fileIndex: number,
  totalFiles: number,
  fileSizeBytes: number,
  emit: (event: ProgressEvent) => void,
  metadata: MetadataConfig | undefined,
  signal?: AbortSignal,
): Promise<ProcessOneFileResult> => {
  if (signal?.aborted) return { kind: "aborted" };

  const isAborted = (): boolean => signal?.aborted === true;
  const srcPath = path.join(dir, file);
  const baseName = path.parse(file).name;

  // Each file gets its own temporary subdirectory to avoid raw_XXX.wav name
  // collisions when multiple files are processed concurrently.
  const tmpSubDir = path.join(outDir, `.sox-tmp-${baseName}`);

  // On any per-file error, no chunk for this file must survive in outDir —
  // this matches the worker pool's per-file atomicity guarantee.
  const failWithCleanup = async (
    reason: string,
  ): Promise<ProcessOneFileResult> => {
    await cleanPartialOutput(outDir, baseName);
    return { kind: "error", reason };
  };

  try {
    // A prior run's tmpSubDir can survive a SIGKILL (the `finally` cleanup
    // below never runs). Without this, listRawChunks would mix leftover raw
    // chunks from that stale run into this one's output.
    await rm(tmpSubDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
    await mkdir(tmpSubDir, { recursive: true });

    const outputBase = path.join(tmpSubDir, "raw_.wav");

    // sox cuts on the input wall-clock at the source sample rate. For
    // expand-10x (AudioMoth at real rate), 5 s of input wall-clock = 5 s
    // real time = 50 s on the (TE×10) output timeline. For preserve
    // (Teensy already TE×10), input wall-clock = output wall-clock, so we
    // feed the full 50 s.
    const segmentSeconds =
      input.mode === "expand-10x"
        ? CHUNK_OUTPUT_SECONDS / TIME_EXPANSION_FACTOR
        : CHUNK_OUTPUT_SECONDS;

    emit({
      kind: "file-start",
      fileIndex,
      fileName: path.basename(file),
      fileSizeBytes,
      totalFiles,
    });

    const { exitCode } = await spawnSoxAsync(
      soxPath,
      srcPath,
      outputBase,
      segmentSeconds,
      signal,
    );

    if (isAborted()) return { kind: "aborted" };

    if (exitCode !== 0) {
      return await failWithCleanup(`sox-exit:${String(exitCode ?? "signal")}`);
    }

    const rawFiles = await listRawChunks(tmpSubDir);
    if (rawFiles.length === 0) {
      return await failWithCleanup("sox-no-output");
    }

    // expand-10x: sox writes source sampleRate (e.g. 250 kHz),
    // rewriteHeaderToStandardPcm divides by 10 to match output rate.
    const expand10x = input.mode === "expand-10x";
    const sourceTimestamp =
      metadata?.enabled === true ? parseSourceTimestamp(file) : null;

    let outputSampleRate = 0;
    let channels = 0;
    let bitsPerSample = 0;
    let chunkIndex = 0;

    for (const rawFile of rawFiles) {
      if (isAborted()) return { kind: "aborted" };

      const rawPath = path.join(tmpSubDir, rawFile);
      await rewriteHeaderToStandardPcm(rawPath, expand10x);

      // Canonical PCM header is always 44 bytes after rewrite — read just
      // that slice rather than the (potentially MB-sized) full file.
      const headerBuf = Buffer.alloc(44);
      const fh = await open(rawPath, "r");
      try {
        await fh.read(headerBuf, 0, 44, 0);
      } finally {
        await fh.close();
      }
      if (chunkIndex === 0) {
        outputSampleRate = headerBuf.readUInt32LE(24);
        channels = headerBuf.readUInt16LE(22);
        bitsPerSample = headerBuf.readUInt16LE(34);
      }

      if (metadata?.enabled === true) {
        const dataSize = headerBuf.readUInt32LE(40);
        const bytesPerSampleAllChannels = (channels * bitsPerSample) / 8;
        if (dataSize % bytesPerSampleAllChannels !== 0) {
          return await failWithCleanup(
            `non-aligned-data-size:${String(dataSize)}/${String(bytesPerSampleAllChannels)}`,
          );
        }
        const chunkSamples = dataSize / bytesPerSampleAllChannels;
        const { guano, wamd } = buildChunkMeta({
          sourceTimestamp,
          chunkIndex,
          chunkSamples,
          outputSampleRate,
          timeExpansion: TIME_EXPANSION_FACTOR,
          originalFilename: file,
          chiroVersion: metadata.chiroVersion,
        });
        await appendAncillaryChunks(rawPath, [
          buildWamdChunk(wamd),
          buildGuanoChunk(guano),
        ]);
      }

      const finalName = buildChunkName(baseName, chunkIndex);
      const finalPath = path.join(outDir, finalName);
      await rename(rawPath, finalPath);

      emit({ kind: "chunk-written", fileIndex, chunkIndex });
      chunkIndex += 1;
    }

    emit({
      kind: "file-done",
      fileIndex,
      chunkCount: chunkIndex,
      fileSizeBytes,
    });

    return {
      kind: "ok",
      processed: {
        sourceFile: file,
        chunkCount: chunkIndex,
        outputSampleRate,
        channels,
      },
      chunkCount: chunkIndex,
    };
  } catch (err) {
    return await failWithCleanup(extractErrorCode(err));
  } finally {
    await rm(tmpSubDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
};

// Spot-checks the sox output for the first processed file against the
// wavefile reference pipeline. Returns null on match, reason string on mismatch.

/**
 * Removes `.sox-tmp-*` scratch directories left by a killed run.
 *
 * The `finally` of `processOneFile` clears its own, but not on `kill -9` or a
 * power cut — and `scanDirectory` deliberately hides dotted entries from the
 * conflict constat, so nothing else ever reports them. Up to a few hundred MB
 * can then sit in `processed/`, invisible in the Finder, collected only by a
 * later run happening to process the *same* base name. Prefixing the files
 * changes every base name, which makes that never happen.
 *
 * Mirrors `preCleanOrphanTmps` in `splitWorkerPool.ts`. Best-effort: a
 * directory a live sibling run is using simply fails to delete and is left.
 */
const preCleanOrphanSoxTmpDirs = async (outDir: string): Promise<void> => {
  let entries: string[];
  try {
    entries = await readdir(outDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith(".sox-tmp-")) continue;
    await rm(path.join(outDir, entry), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
  }
};

export const runSoxBatch = async (
  soxPath: string,
  files: string[],
  dir: string,
  input: ProcessInput,
  options?: {
    signal?: AbortSignal;
    maxInputBytes?: number;
    onProgress?: (event: ProgressEvent) => void;
    metadata?: MetadataConfig;
  },
): Promise<SoxBatchResult> => {
  const start = performance.now();
  const signal = options?.signal;
  const isAborted = (): boolean => signal?.aborted === true;
  const maxInputBytes = options?.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const outDir = buildOutDir(dir);
  const emit = makeEmit(options?.onProgress);

  await preCleanOrphanSoxTmpDirs(outDir);

  const state = {
    processed: [] as ProcessedFile[],
    errored: [] as ProcessError[],
    skippedTooLarge: [] as string[],
    skippedAlreadyChunked: [] as string[],
    interrupted: false,
  };

  try {
    await mkdir(outDir, { recursive: true });
  } catch (err) {
    const code = extractErrorCode(err);
    for (const f of files) {
      state.errored.push({ file: f, reason: `mkdir:${code}` });
    }
    return {
      kind: "completed",
      outcome: { ...state, durationMs: performance.now() - start },
    };
  }

  const { queue, skippedTooLarge, skippedAlreadyChunked, errored } =
    await buildQueue(files, dir, maxInputBytes);
  state.skippedTooLarge = skippedTooLarge;
  state.skippedAlreadyChunked = skippedAlreadyChunked;
  state.errored = errored;

  if (queue.length === 0 || isAborted()) {
    if (isAborted()) state.interrupted = true;
    return {
      kind: "completed",
      outcome: { ...state, durationMs: performance.now() - start },
    };
  }

  const firstItem = queue[0];
  if (!firstItem) {
    return {
      kind: "completed",
      outcome: { ...state, durationMs: performance.now() - start },
    };
  }

  const firstFile = firstItem.file;
  const firstSrcPath = firstItem.absSource;
  let firstSourceBuffer: Buffer;
  try {
    firstSourceBuffer = await readFile(firstSrcPath);
  } catch (err) {
    const code = extractErrorCode(err);
    state.errored.push({ file: firstFile, reason: code });
    return {
      kind: "fallback",
      reason: `could not read first file: ${code}`,
    };
  }

  if (isAborted()) {
    state.interrupted = true;
    return {
      kind: "completed",
      outcome: { ...state, durationMs: performance.now() - start },
    };
  }

  const firstResult = await processOneFile(
    soxPath,
    firstFile,
    dir,
    outDir,
    input,
    firstItem.fileIndex,
    files.length,
    firstItem.fileSizeBytes,
    emit,
    options?.metadata,
    signal,
  );

  if (firstResult.kind === "aborted") {
    state.interrupted = true;
    return {
      kind: "completed",
      outcome: { ...state, durationMs: performance.now() - start },
    };
  }

  if (firstResult.kind === "error") {
    // processOneFile already cleaned up its own partial output on error.
    return {
      kind: "fallback",
      reason: `first-file sox error: ${firstResult.reason}`,
    };
  }

  const spotCheckReason = await runSpotCheck(
    firstSourceBuffer,
    outDir,
    firstItem.baseName,
    firstResult.chunkCount,
    input.mode,
  );

  if (spotCheckReason !== null) {
    // Unlike a processOneFile error, this file succeeded — its chunks are
    // already in outDir and must be cleaned up explicitly here.
    await cleanPartialOutput(outDir, firstItem.baseName);
    return {
      kind: "fallback",
      reason: spotCheckReason,
    };
  }

  state.processed.push(firstResult.processed);

  if (isAborted()) {
    state.interrupted = true;
    return {
      kind: "completed",
      outcome: { ...state, durationMs: performance.now() - start },
    };
  }

  const remaining = queue.slice(1);
  if (remaining.length === 0) {
    return {
      kind: "completed",
      outcome: { ...state, durationMs: performance.now() - start },
    };
  }

  const concurrency = Math.min(computeConcurrency(), remaining.length);
  let nextIdx = 0;
  const inFlight = new Set<Promise<void>>();

  const runItem = async (item: {
    file: string;
    fileIndex: number;
    fileSizeBytes: number;
  }): Promise<void> => {
    if (isAborted()) {
      state.interrupted = true;
      return;
    }

    const result = await processOneFile(
      soxPath,
      item.file,
      dir,
      outDir,
      input,
      item.fileIndex,
      files.length,
      item.fileSizeBytes,
      emit,
      options?.metadata,
      signal,
    );

    if (result.kind === "aborted") {
      state.interrupted = true;
    } else if (result.kind === "error") {
      state.errored.push({ file: item.file, reason: result.reason });
    } else {
      state.processed.push(result.processed);
    }
  };

  // Wrap each item run so that on completion it schedules the next item
  const scheduleItem = (item: {
    file: string;
    fileIndex: number;
    fileSizeBytes: number;
  }): Promise<void> => {
    const p: Promise<void> = runItem(item).then(() => {
      inFlight.delete(p);
      if (nextIdx < remaining.length && !isAborted()) {
        const nextItem = remaining[nextIdx];
        if (nextItem) {
          nextIdx += 1;
          const next = scheduleItem(nextItem);
          inFlight.add(next);
        }
      }
    });
    return p;
  };

  for (let i = 0; i < concurrency; i++) {
    if (nextIdx >= remaining.length) break;
    const item = remaining[nextIdx];
    if (!item) break;
    nextIdx += 1;
    inFlight.add(scheduleItem(item));
  }

  while (inFlight.size > 0) {
    await Promise.race(inFlight);
  }

  if (isAborted()) state.interrupted = true;

  return {
    kind: "completed",
    outcome: { ...state, durationMs: performance.now() - start },
  };
};
