import { statSync } from "node:fs";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import { WaveFile } from "wavefile";
import type {
  ProcessError,
  ProcessInput,
  ProcessOutcome,
  ProcessedFile,
  ProgressEvent,
} from "../../types.js";
import { splitWavFile } from "./splitWavFile.js";
import { rewriteHeaderToStandardPcm } from "./wavHeader.js";
import { appendAncillaryChunks } from "./finalizeChunk.js";
import { clampWorkerCount } from "./splitWorkerPool.js";
import { CHUNK_OUTPUT_SECONDS, TIME_EXPANSION_FACTOR } from "./constants.js";
import { buildChunkMeta } from "./metadata/chunkMetadata.js";
import { buildGuanoChunk } from "./metadata/guano.js";
import { buildWamdChunk } from "./metadata/wamd.js";
import { parseSourceTimestamp } from "../files/parseTimestamp.js";
import type { MetadataConfig } from "../../types.js";

export type SoxAvailability =
  | { kind: "available"; binPath: string }
  | { kind: "absent" };

export type SoxBatchResult =
  | { kind: "completed"; outcome: ProcessOutcome }
  | { kind: "fallback"; reason: string; partialOutcome: ProcessOutcome };

const ALREADY_CHUNKED_REGEX = /_\d{3}\.wav$/i;
const DEFAULT_MAX_INPUT_BYTES = 500 * 1024 * 1024;
const PROCESSED_DIRNAME = "processed";

// Spot-check: compare this many samples from the middle of each verified chunk
const SPOT_CHECK_SAMPLE_COUNT = 100;

// Resolves the full path of a binary by searching PATH entries.
// Uses statSync to check file existence without spawning a subprocess,
// so it works even when PATH is restricted to a custom directory in tests.
const which = (name: string): string | null => {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      const st = statSync(candidate);
      // Check that the file is executable (owner, group, or other exec bit)
      if (st.isFile() && (st.mode & 0o111) !== 0) return candidate;
    } catch {
      // file does not exist or no access — try next
    }
  }
  return null;
};

export const detectSox = (): Promise<SoxAvailability> => {
  if (process.env.CHIRO_DISABLE_FASTPATH) {
    return Promise.resolve({ kind: "absent" });
  }

  const binPath = which("sox");
  if (binPath === null) {
    return Promise.resolve({ kind: "absent" });
  }

  try {
    const result = spawnSync(binPath, ["--version"], { encoding: "utf8" });
    if (result.status !== 0) {
      return Promise.resolve({ kind: "absent" });
    }
  } catch {
    return Promise.resolve({ kind: "absent" });
  }

  return Promise.resolve({ kind: "available", binPath });
};

const computeConcurrency = (): number => {
  const envOverride = process.env.CHIRO_WORKER_COUNT;
  if (envOverride !== undefined && envOverride !== "") {
    const parsed = parseInt(envOverride, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const cpuCount = os.cpus().length;
  const totalMB = os.totalmem() / (1024 * 1024);
  return clampWorkerCount(cpuCount, totalMB);
};

const buildOutDir = (dir: string): string => path.join(dir, PROCESSED_DIRNAME);

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
    | Int16Array
    | Int32Array
    | (Int16Array | Int32Array)[];
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

const fingerprintReferenceChunk = (
  sourceBuffer: Buffer,
  mode: ProcessInput["mode"],
  targetIndex: number,
): string | null => {
  for (const yielded of splitWavFile(sourceBuffer, {
    mode,
    chunkSeconds: CHUNK_OUTPUT_SECONDS,
  })) {
    if (yielded.kind !== "chunk") continue;
    const { chunk } = yielded;
    if (chunk.index !== targetIndex) continue;

    const channel = decodeFirstChannelSamples(Buffer.from(chunk.buffer));
    if (channel === null || channel.length === 0) return null;
    return middleSamplesFingerprint(channel);
  }
  return null;
};

// Lists sox-produced raw files in numerical order
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

// Cleans up partial sox output for a file — leaves no state on fallback.
// Removes the final chunks (baseName_NNN.wav) and the tmp subdirectory.
const cleanPartialOutput = async (
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
  for (const entry of entries) {
    if (entry.startsWith(baseName) && entry.endsWith(".wav")) {
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
  await mkdir(tmpSubDir, { recursive: true });

  const outputBase = path.join(tmpSubDir, "raw_.wav");

  // sox cuts on the input wall-clock at the source sample rate. For
  // expand-10x (AudioMoth at real rate), 5 s of input wall-clock = 5 s real
  // time = 50 s on the (TE×10) output timeline. For preserve (Teensy already
  // TE×10), input wall-clock = output wall-clock, so we feed the full 50 s.
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

  if (isAborted()) {
    await rm(tmpSubDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
    return { kind: "aborted" };
  }

  if (exitCode !== 0) {
    await rm(tmpSubDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
    return {
      kind: "error",
      reason: `sox-exit:${String(exitCode ?? "signal")}`,
    };
  }

  const rawFiles = await listRawChunks(tmpSubDir);
  if (rawFiles.length === 0) {
    await rm(tmpSubDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
    return { kind: "error", reason: "sox-no-output" };
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
    if (isAborted()) {
      await rm(tmpSubDir, { recursive: true, force: true }).catch(
        () => undefined,
      );
      return { kind: "aborted" };
    }

    const rawPath = path.join(tmpSubDir, rawFile);
    await rewriteHeaderToStandardPcm(rawPath, expand10x);

    // Canonical PCM header is always 44 bytes after rewrite — read just that
    // slice rather than the (potentially MB-sized) full file.
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
        return {
          kind: "error",
          reason: `non-aligned-data-size:${String(dataSize)}/${String(bytesPerSampleAllChannels)}`,
        };
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

    const paddedIndex = String(chunkIndex).padStart(3, "0");
    const finalName = `${baseName}_${paddedIndex}.wav`;
    const finalPath = path.join(outDir, finalName);
    await rename(rawPath, finalPath);

    emit({ kind: "chunk-written", fileIndex, chunkIndex });
    chunkIndex += 1;
  }

  await rm(tmpSubDir, { recursive: true, force: true }).catch(() => undefined);

  emit({ kind: "file-done", fileIndex, chunkCount: chunkIndex, fileSizeBytes });

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
};

// Spot-checks the sox output for the first processed file against the
// wavefile reference pipeline. Returns null on match, reason string on mismatch.
const runSpotCheck = async (
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

  for (const idx of checkIndices) {
    const paddedIndex = String(idx).padStart(3, "0");
    const chunkPath = path.join(outDir, `${baseName}_${paddedIndex}.wav`);

    const soxFingerprint = await fingerprintChunkMiddle(chunkPath);
    if (soxFingerprint === null) {
      return `spot-check: could not decode chunk ${String(idx)}`;
    }

    const refFingerprint = fingerprintReferenceChunk(sourceBuffer, mode, idx);
    if (refFingerprint === null) {
      return `spot-check: could not decode reference chunk ${String(idx)}`;
    }

    if (soxFingerprint !== refFingerprint) {
      return `spot-check mismatch on chunk ${String(idx)}`;
    }
  }

  return null;
};

const makeEmit = (
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
    const code =
      err instanceof Error && "code" in err
        ? String((err as { code: unknown }).code)
        : "UNKNOWN";
    for (const f of files) {
      state.errored.push({ file: f, reason: `mkdir:${code}` });
    }
    return {
      kind: "completed",
      outcome: { ...state, durationMs: performance.now() - start },
    };
  }

  type QueuedItem = {
    file: string;
    fileIndex: number;
    fileSizeBytes: number;
  };

  const { stat } = await import("node:fs/promises");

  const queue: QueuedItem[] = [];
  let globalFileIndex = 0;

  for (const file of files) {
    const fileIndex = globalFileIndex;
    globalFileIndex += 1;

    if (ALREADY_CHUNKED_REGEX.test(file)) {
      state.skippedAlreadyChunked.push(file);
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
      state.errored.push({ file, reason: code });
      continue;
    }

    if (size > maxInputBytes) {
      state.skippedTooLarge.push(file);
      continue;
    }

    queue.push({ file, fileIndex, fileSizeBytes: size });
  }

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
  const firstSrcPath = path.join(dir, firstFile);
  let firstSourceBuffer: Buffer;
  try {
    firstSourceBuffer = await readFile(firstSrcPath);
  } catch (err) {
    const code =
      err instanceof Error && "code" in err
        ? String((err as { code: unknown }).code)
        : "UNKNOWN";
    state.errored.push({ file: firstFile, reason: code });
    return {
      kind: "fallback",
      reason: `could not read first file: ${code}`,
      partialOutcome: { ...state, durationMs: performance.now() - start },
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
    const baseName = path.parse(firstFile).name;
    await cleanPartialOutput(outDir, baseName);
    return {
      kind: "fallback",
      reason: `first-file sox error: ${firstResult.reason}`,
      partialOutcome: { ...state, durationMs: performance.now() - start },
    };
  }

  const spotCheckReason = await runSpotCheck(
    firstSourceBuffer,
    outDir,
    path.parse(firstFile).name,
    firstResult.chunkCount,
    input.mode,
  );

  if (spotCheckReason !== null) {
    const baseName = path.parse(firstFile).name;
    await cleanPartialOutput(outDir, baseName);
    return {
      kind: "fallback",
      reason: spotCheckReason,
      partialOutcome: { ...state, durationMs: performance.now() - start },
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
