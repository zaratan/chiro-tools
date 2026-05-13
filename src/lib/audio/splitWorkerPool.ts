import os from "node:os";
import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import workerBundleAsset from "./splitWorker.bundled.mjs" with { type: "file" };
import type { WorkerInMessage, WorkerOutMessage } from "./splitWorker.js";
import type {
  ProcessInput,
  ProcessOutcome,
  ProcessedFile,
  ProcessError,
  ProgressEvent,
} from "../../types.js";

// In `bun --compile` the asset import resolves to a string path in /$bunfs/.
// Vitest does not honour `with { type: "file" }` and yields the module's
// exports instead, so we fall back to a sibling-file lookup via import.meta.url.
const resolveWorkerPath = (): string => {
  const asset: unknown = workerBundleAsset;
  if (typeof asset === "string") return asset;
  const dir = fileURLToPath(new URL(".", import.meta.url));
  return path.join(dir, "splitWorker.bundled.mjs");
};

const CHUNK_SECONDS = 5;
const ABORT_TIMEOUT_MS = 2000;
const MEMORY_PER_WORKER_MB = 400;
const MEMORY_USABLE_FRACTION = 0.7;
const HARD_CAP = 12;
const MIN_WORKERS = 2;

export const clampWorkerCount = (cpuCount: number, totalMB: number): number => {
  const usableMB = totalMB * MEMORY_USABLE_FRACTION;
  const maxByMemory = Math.floor(usableMB / MEMORY_PER_WORKER_MB);
  const maxByCpu = cpuCount - 1;
  return Math.max(MIN_WORKERS, Math.min(maxByMemory, maxByCpu, HARD_CAP));
};

const computeWorkerCount = (): number => {
  const envOverride = process.env.CHIRO_WORKER_COUNT;
  if (envOverride !== undefined && envOverride !== "") {
    const parsed = parseInt(envOverride, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const cpuCount = os.cpus().length;
  const totalMB = os.totalmem() / (1024 * 1024);
  return clampWorkerCount(cpuCount, totalMB);
};

type WorkerState = {
  worker: Worker;
  idle: boolean;
  abortedResolve: (() => void) | null;
};

type QueuedFile = {
  filePath: string;
  fileIndex: number;
  baseName: string;
  fileSizeBytes: number;
};

type BatchState = {
  processed: ProcessedFile[];
  errored: ProcessError[];
  skippedTooLarge: string[];
  skippedAlreadyChunked: string[];
  interrupted: boolean;
};

const ALREADY_CHUNKED_REGEX = /_\d{3}\.wav$/i;
const DEFAULT_MAX_INPUT_BYTES = 500 * 1024 * 1024;
const PROCESSED_DIRNAME = "processed";

const buildOutDir = (dir: string): string => path.join(dir, PROCESSED_DIRNAME);

const makeEmit = (
  onProgress: (event: ProgressEvent) => void,
): ((event: ProgressEvent) => void) => {
  return (event: ProgressEvent): void => {
    try {
      onProgress(event);
    } catch {
      // swallow — a buggy callback must not crash the pool
    }
  };
};

const preCleanOrphanTmps = async (outDir: string): Promise<void> => {
  let entries: string[];
  try {
    entries = await readdir(outDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.endsWith(".tmp")) {
      await unlink(path.join(outDir, entry)).catch(() => undefined);
    }
  }
};

// Sends abort to all workers and waits for their "aborted" acknowledgement
// (with timeout), then terminates any that didn't respond.
const abortAndWaitWorkers = async (
  workerStates: WorkerState[],
): Promise<void> => {
  const abortedPromises = workerStates.map((ws) => {
    return new Promise<void>((resolve) => {
      ws.abortedResolve = resolve;
      const abortMsg: WorkerInMessage = { kind: "abort" };
      ws.worker.postMessage(abortMsg);
    });
  });

  const timeout = new Promise<void>((resolve) =>
    setTimeout(resolve, ABORT_TIMEOUT_MS),
  );

  await Promise.race([Promise.all(abortedPromises), timeout]);

  // Force-terminate any workers that didn't respond in time
  await Promise.allSettled(
    workerStates.map((ws) => ws.worker.terminate().catch(() => undefined)),
  );
};

const terminateWorkers = async (workerStates: WorkerState[]): Promise<void> => {
  await Promise.allSettled(
    workerStates.map((ws) => ws.worker.terminate().catch(() => undefined)),
  );
};

export const run = async (
  files: string[],
  dir: string,
  input: ProcessInput,
  options?: {
    signal?: AbortSignal;
    maxInputBytes?: number;
    onProgress?: (event: ProgressEvent) => void;
  },
): Promise<ProcessOutcome> => {
  const start = performance.now();
  const signal = options?.signal;
  const isAborted = (): boolean => signal?.aborted === true;
  const maxInputBytes = options?.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const outDir = buildOutDir(dir);

  const emit = options?.onProgress
    ? makeEmit(options.onProgress)
    : (_event: ProgressEvent): void => undefined;

  const state: BatchState = {
    processed: [],
    errored: [],
    skippedTooLarge: [],
    skippedAlreadyChunked: [],
    interrupted: false,
  };

  const { mkdir, stat } = await import("node:fs/promises");

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
    return { ...state, durationMs: performance.now() - start };
  }

  await preCleanOrphanTmps(outDir);

  const queue: QueuedFile[] = [];
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

    queue.push({
      filePath: absSource,
      fileIndex,
      baseName: path.parse(file).name,
      fileSizeBytes: size,
    });
  }

  if (queue.length === 0 || isAborted()) {
    if (isAborted()) state.interrupted = true;
    return { ...state, durationMs: performance.now() - start };
  }

  const workerCount = Math.min(computeWorkerCount(), queue.length);
  const workerStates: WorkerState[] = [];
  const fileSizeMap = new Map<number, number>();
  for (const q of queue) {
    fileSizeMap.set(q.fileIndex, q.fileSizeBytes);
  }

  let pendingFiles = queue.length;
  let nextQueueIndex = 0;
  let batchAborted = false;

  const batchDone = await new Promise<boolean>((resolveBatch) => {
    const checkDone = (): void => {
      if (pendingFiles <= 0) {
        resolveBatch(false);
      }
    };

    const dispatchToWorker = (ws: WorkerState): void => {
      if (nextQueueIndex >= queue.length || batchAborted) return;

      const item = queue[nextQueueIndex];
      if (item === undefined) return;
      nextQueueIndex += 1;

      ws.idle = false;

      emit({
        kind: "file-start",
        fileIndex: item.fileIndex,
        fileName: path.basename(item.filePath),
        fileSizeBytes: item.fileSizeBytes,
        totalFiles: files.length,
      });

      const msg: WorkerInMessage = {
        kind: "process-file",
        path: item.filePath,
        mode: input.mode,
        chunkSeconds: CHUNK_SECONDS,
        outDir,
        fileIndex: item.fileIndex,
        baseName: item.baseName,
      };
      ws.worker.postMessage(msg);
    };

    const handleMessage =
      (ws: WorkerState) =>
      (raw: unknown): void => {
        const msg = raw as WorkerOutMessage;

        if (msg.kind === "chunk-written") {
          emit({
            kind: "chunk-written",
            fileIndex: msg.fileIndex,
            chunkIndex: msg.chunkIndex,
          });
          return;
        }

        if (msg.kind === "file-done") {
          const size = fileSizeMap.get(msg.fileIndex) ?? 0;
          state.processed.push({
            sourceFile: files[msg.fileIndex] ?? "",
            chunkCount: msg.chunkCount,
            outputSampleRate: msg.outputSampleRate,
            channels: msg.channels,
          });
          emit({
            kind: "file-done",
            fileIndex: msg.fileIndex,
            chunkCount: msg.chunkCount,
            fileSizeBytes: size,
          });
          pendingFiles -= 1;
          ws.idle = true;
          dispatchToWorker(ws);
          checkDone();
          return;
        }

        if (msg.kind === "file-error") {
          const sourceFile = files[msg.fileIndex] ?? "";
          state.errored.push({ file: sourceFile, reason: msg.reason });
          pendingFiles -= 1;
          ws.idle = true;
          dispatchToWorker(ws);
          checkDone();
          return;
        }

        // msg.kind === "aborted": worker has finished any in-flight rename.
        // Resolve the per-worker abort promise so abortAndWaitWorkers can proceed.
        if (ws.abortedResolve !== null) {
          ws.abortedResolve();
          ws.abortedResolve = null;
        }
      };

    const workerBundlePath = resolveWorkerPath();
    for (let i = 0; i < workerCount; i++) {
      const ws: WorkerState = {
        worker: new Worker(workerBundlePath),
        idle: true,
        abortedResolve: null,
      };
      ws.worker.on("message", handleMessage(ws));
      workerStates.push(ws);
    }

    if (isAborted()) {
      batchAborted = true;
      resolveBatch(true);
      return;
    }

    for (const ws of workerStates) {
      dispatchToWorker(ws);
    }

    signal?.addEventListener(
      "abort",
      () => {
        batchAborted = true;
        state.interrupted = true;
        resolveBatch(true);
      },
      { once: true },
    );
  });

  if (batchDone) {
    // Abort path: send abort to workers and wait for them to finish in-flight
    // renames before terminating. This guarantees no orphan .tmp on disk.
    await abortAndWaitWorkers(workerStates);
  } else {
    await terminateWorkers(workerStates);
  }

  return { ...state, durationMs: performance.now() - start };
};
