import { mkdir, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import workerBundleAsset from "./splitWorker.bundled.mjs" with { type: "file" };
import type {
  WorkerInMessage,
  WorkerMetaConfig,
  WorkerOutMessage,
} from "./splitWorker.js";
import { CHUNK_OUTPUT_SECONDS } from "./constants.js";
import { parseSourceTimestamp } from "../files/parseTimestamp.js";
import { extractErrorCode } from "../fs/safeFsOps.js";
import {
  buildOutDir,
  buildQueue,
  computeConcurrency,
  DEFAULT_MAX_INPUT_BYTES,
  makeEmit,
} from "./batchPlan.js";
import type {
  MetadataConfig,
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

const ABORT_TIMEOUT_MS = 2000;
// Stable error codes surfaced to the UI as `ProcessError.reason`. Any new
// value added here must also be added to
// `src/screens/vigie-process/errorMessages.ts`, its EMITTED_CODES test, and
// the error code table in docs/ux.md.
const WORKER_SPAWN_FAILED_REASON = "worker-spawn-failed";
const NO_WORKERS_AVAILABLE_REASON = "no-workers-available";
const WORKER_DIED_REASON = "worker-died";

type WorkerState = {
  worker: Worker;
  idle: boolean;
  alive: boolean;
  currentFileIndex: number | null;
  abortedResolve: (() => void) | null;
};

type BatchState = {
  processed: ProcessedFile[];
  errored: ProcessError[];
  skippedTooLarge: string[];
  skippedAlreadyChunked: string[];
  interrupted: boolean;
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

// Sends abort to all live workers and waits for busy ones' "aborted"
// acknowledgement (with timeout), then terminates every worker. Idle workers
// never ack (splitWorker.ts returns early on abort when nothing is in
// flight), so waiting on them would burn the full timeout on every abort.
const abortAndWaitWorkers = async (
  workerStates: WorkerState[],
  abortTimeoutMs: number,
): Promise<void> => {
  const aliveStates = workerStates.filter((ws) => ws.alive);
  const busyStates = aliveStates.filter((ws) => !ws.idle);

  const abortedPromises = busyStates.map((ws) => {
    return new Promise<void>((resolve) => {
      ws.abortedResolve = resolve;
      const abortMsg: WorkerInMessage = { kind: "abort" };
      ws.worker.postMessage(abortMsg);
    });
  });

  for (const ws of aliveStates) {
    if (ws.idle) {
      const abortMsg: WorkerInMessage = { kind: "abort" };
      ws.worker.postMessage(abortMsg);
    }
  }

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(resolve, abortTimeoutMs);
  });

  await Promise.race([Promise.all(abortedPromises), timeout]);
  if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);

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

const buildWorkerMeta = (
  fileName: string,
  metadata: MetadataConfig | undefined,
): WorkerMetaConfig => {
  if (!metadata?.enabled) return { enabled: false };
  const ts = parseSourceTimestamp(fileName);
  return {
    enabled: true,
    originalFilename: fileName,
    sourceTimestamp: ts === null ? null : ts.getTime(),
    chiroVersion: metadata.chiroVersion,
  };
};

export const run = async (
  files: string[],
  dir: string,
  input: ProcessInput,
  options?: {
    signal?: AbortSignal;
    maxInputBytes?: number;
    onProgress?: (event: ProgressEvent) => void;
    metadata?: MetadataConfig;
    // Overrides the worker bundle path. Test-only escape hatch to exercise
    // worker crash handling without mocking node:worker_threads.
    workerPath?: string;
    // Overrides the abort-ack timeout. Test-only: timing tests set it high
    // so "the abort path did not burn the timeout" can be asserted without
    // a load-sensitive wall-clock bound (flaky on slow CI runners).
    abortTimeoutMs?: number;
  },
): Promise<ProcessOutcome> => {
  const start = performance.now();
  const signal = options?.signal;
  const isAborted = (): boolean => signal?.aborted === true;
  const maxInputBytes = options?.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;
  const abortTimeoutMs = options?.abortTimeoutMs ?? ABORT_TIMEOUT_MS;
  const outDir = buildOutDir(dir);

  const emit = makeEmit(options?.onProgress);

  const state: BatchState = {
    processed: [],
    errored: [],
    skippedTooLarge: [],
    skippedAlreadyChunked: [],
    interrupted: false,
  };

  try {
    await mkdir(outDir, { recursive: true });
  } catch (err) {
    const code = extractErrorCode(err);
    for (const f of files) {
      state.errored.push({ file: f, reason: `mkdir:${code}` });
    }
    return { ...state, durationMs: performance.now() - start };
  }

  await preCleanOrphanTmps(outDir);

  const { queue, skippedTooLarge, skippedAlreadyChunked, errored } =
    await buildQueue(files, dir, maxInputBytes);
  state.skippedTooLarge = skippedTooLarge;
  state.skippedAlreadyChunked = skippedAlreadyChunked;
  state.errored = errored;

  if (queue.length === 0 || isAborted()) {
    if (isAborted()) state.interrupted = true;
    return { ...state, durationMs: performance.now() - start };
  }

  const workerCount = Math.min(computeConcurrency(), queue.length);
  const fileSizeMap = new Map<number, number>();
  for (const q of queue) {
    fileSizeMap.set(q.fileIndex, q.fileSizeBytes);
  }

  const workerBundlePath = options?.workerPath ?? resolveWorkerPath();
  const workerStates: WorkerState[] = [];
  try {
    for (let i = 0; i < workerCount; i++) {
      workerStates.push({
        worker: new Worker(workerBundlePath),
        idle: true,
        alive: true,
        currentFileIndex: null,
        abortedResolve: null,
      });
    }
  } catch {
    await terminateWorkers(workerStates);
    for (const item of queue) {
      state.errored.push({
        file: files[item.fileIndex] ?? "",
        reason: WORKER_SPAWN_FAILED_REASON,
      });
    }
    return { ...state, durationMs: performance.now() - start };
  }

  let pendingFiles = queue.length;
  let nextQueueIndex = 0;
  let batchAborted = false;

  const batchDone = await new Promise<boolean>((resolveBatch) => {
    let batchSettled = false;
    const resolveBatchOnce = (aborted: boolean): void => {
      if (batchSettled) return;
      batchSettled = true;
      resolveBatch(aborted);
    };

    const checkDone = (): void => {
      if (pendingFiles <= 0) {
        resolveBatchOnce(false);
      }
    };

    const dispatchToWorker = (ws: WorkerState): void => {
      if (!ws.alive || nextQueueIndex >= queue.length || batchAborted) return;

      const item = queue[nextQueueIndex];
      if (item === undefined) return;
      nextQueueIndex += 1;

      ws.idle = false;
      ws.currentFileIndex = item.fileIndex;

      emit({
        kind: "file-start",
        fileIndex: item.fileIndex,
        fileName: item.file,
        fileSizeBytes: item.fileSizeBytes,
        totalFiles: files.length,
      });

      const msg: WorkerInMessage = {
        kind: "process-file",
        path: item.absSource,
        mode: input.mode,
        chunkSeconds: CHUNK_OUTPUT_SECONDS,
        outDir,
        fileIndex: item.fileIndex,
        baseName: item.baseName,
        meta: buildWorkerMeta(item.file, options?.metadata),
      };
      ws.worker.postMessage(msg);
    };

    // Marks every not-yet-dispatched queued file as errored. Used once every
    // worker has died, since nothing remains to drain the queue.
    const failRemainingQueue = (): void => {
      while (nextQueueIndex < queue.length) {
        const item = queue[nextQueueIndex];
        nextQueueIndex += 1;
        if (item === undefined) continue;
        state.errored.push({
          file: files[item.fileIndex] ?? "",
          reason: NO_WORKERS_AVAILABLE_REASON,
        });
        pendingFiles -= 1;
      }
    };

    // Handles a worker dying without ever posting file-done/file-error (OOM,
    // unresolved bundle, uncaught exception at load time, or an unexpected
    // clean exit while a file was still in flight). Guards against double
    // handling when both "error" and "exit" fire for the same death. The
    // reason is always the stable WORKER_DIED_REASON — the underlying error
    // detail is not surfaced, since the UI maps on the code, not the message.
    const handleWorkerDeath = (ws: WorkerState): void => {
      if (!ws.alive) return;
      ws.alive = false;

      if (ws.abortedResolve !== null) {
        ws.abortedResolve();
        ws.abortedResolve = null;
      }

      if (batchSettled) return;

      if (ws.currentFileIndex !== null) {
        const sourceFile = files[ws.currentFileIndex] ?? "";
        state.errored.push({ file: sourceFile, reason: WORKER_DIED_REASON });
        ws.currentFileIndex = null;
        pendingFiles -= 1;
      }

      if (workerStates.every((other) => !other.alive)) {
        failRemainingQueue();
      }

      checkDone();
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
          ws.currentFileIndex = null;
          ws.idle = true;
          // If abort fired between the worker posting file-done and this
          // handler running, the worker is actually idle now and will never
          // post "aborted" (splitWorker.ts only acks abort while busy) — ack
          // on its behalf so abortAndWaitWorkers doesn't burn the timeout.
          if (batchAborted && ws.abortedResolve !== null) {
            ws.abortedResolve();
            ws.abortedResolve = null;
          }
          dispatchToWorker(ws);
          checkDone();
          return;
        }

        if (msg.kind === "file-error") {
          const sourceFile = files[msg.fileIndex] ?? "";
          state.errored.push({ file: sourceFile, reason: msg.reason });
          pendingFiles -= 1;
          ws.currentFileIndex = null;
          ws.idle = true;
          if (batchAborted && ws.abortedResolve !== null) {
            ws.abortedResolve();
            ws.abortedResolve = null;
          }
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

    for (const ws of workerStates) {
      ws.worker.on("message", handleMessage(ws));
      ws.worker.on("error", () => {
        handleWorkerDeath(ws);
      });
      ws.worker.on("exit", (code) => {
        // A non-zero exit is always a death. A zero (clean) exit is also a
        // death if a file was still in flight — e.g. worker code that calls
        // process.exit(0) mid-file. Without the second condition, such an
        // exit would leave pendingFiles undecremented and the batch pending
        // forever (handleWorkerDeath's `if (!ws.alive) return;` already
        // guards against double-handling when both "error" and "exit" fire
        // for the same death).
        if (code !== 0 || ws.currentFileIndex !== null) {
          handleWorkerDeath(ws);
        }
      });
    }

    signal?.addEventListener(
      "abort",
      () => {
        batchAborted = true;
        state.interrupted = true;
        resolveBatchOnce(true);
      },
      { once: true },
    );

    if (isAborted()) {
      batchAborted = true;
      state.interrupted = true;
      resolveBatchOnce(true);
      return;
    }

    for (const ws of workerStates) {
      dispatchToWorker(ws);
    }
  });

  if (batchDone) {
    // Abort path: send abort to workers and wait for them to finish in-flight
    // renames before terminating. This guarantees no orphan .tmp on disk.
    await abortAndWaitWorkers(workerStates, abortTimeoutMs);
  } else {
    await terminateWorkers(workerStates);
  }

  return { ...state, durationMs: performance.now() - start };
};
