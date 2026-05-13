import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { parentPort } from "node:worker_threads";
import { finalizeChunk } from "./finalizeChunk.js";
import { splitWavFile } from "./splitWavFile.js";
import { TIME_EXPANSION_FACTOR } from "./constants.js";
import { buildChunkMeta } from "./metadata/chunkMetadata.js";
import { buildGuanoChunk } from "./metadata/guano.js";
import { buildWamdChunk } from "./metadata/wamd.js";
import type { TimeExpansionMode } from "../../types.js";

export type WorkerMetaConfig =
  | { enabled: false }
  | {
      enabled: true;
      originalFilename: string;
      sourceTimestamp: number | null; // Date.getTime(), serialisable
      chiroVersion: string;
    };

export type WorkerInMessage =
  | {
      kind: "process-file";
      path: string;
      mode: TimeExpansionMode;
      chunkSeconds: number;
      outDir: string;
      fileIndex: number;
      baseName: string;
      meta: WorkerMetaConfig;
    }
  | { kind: "abort" };

export type WorkerOutMessage =
  | { kind: "chunk-written"; fileIndex: number; chunkIndex: number }
  | {
      kind: "file-done";
      fileIndex: number;
      chunkCount: number;
      fileSizeBytes: number;
      outputSampleRate: number;
      channels: number;
    }
  | { kind: "file-error"; fileIndex: number; reason: string }
  | { kind: "aborted" };

const port = parentPort;

const post = (msg: WorkerOutMessage): void => {
  if (port !== null) port.postMessage(msg);
};

const padIndex = (n: number): string => String(n).padStart(3, "0");

let abortRequested = false;

const writeTmpAndRename = async (
  outDir: string,
  chunkName: string,
  data: Uint8Array,
  ancillaries: Buffer[],
): Promise<void> => {
  const tmpSuffix = randomUUID().slice(0, 8);
  const finalPath = `${outDir}/${chunkName}`;
  const tmpPath = `${finalPath}.${tmpSuffix}.tmp`;

  await writeFile(tmpPath, data);
  // splitWavFile already encodes the correct output sample rate in the buffer.
  // finalizeChunk canonicalises the header (strips LIST/JUNK/fact, forces
  // audioFormat=1) and appends ancillary chunks (wamd, GUANO) when provided.
  await finalizeChunk(tmpPath, { expand10x: false, ancillaries });
  await rename(tmpPath, finalPath);
};

const buildAncillaries = (
  meta: WorkerMetaConfig,
  chunkIndex: number,
  chunkSamples: number,
  outputSampleRate: number,
): Buffer[] => {
  if (!meta.enabled) return [];
  const { guano, wamd } = buildChunkMeta({
    sourceTimestamp:
      meta.sourceTimestamp === null ? null : new Date(meta.sourceTimestamp),
    chunkIndex,
    chunkSamples,
    outputSampleRate,
    timeExpansion: TIME_EXPANSION_FACTOR,
    originalFilename: meta.originalFilename,
    chiroVersion: meta.chiroVersion,
  });
  return [buildWamdChunk(wamd), buildGuanoChunk(guano)];
};

const processFile = async (
  msg: Extract<WorkerInMessage, { kind: "process-file" }>,
): Promise<void> => {
  const {
    path: filePath,
    mode,
    chunkSeconds,
    outDir,
    fileIndex,
    baseName,
    meta,
  } = msg;

  let fileSizeBytes: number;
  let buffer: Uint8Array;
  try {
    buffer = await readFile(filePath);
    fileSizeBytes = buffer.byteLength;
  } catch (err) {
    const reason =
      err instanceof Error && "code" in err
        ? String((err as { code: unknown }).code)
        : "UNKNOWN";
    post({
      kind: "file-error",
      fileIndex,
      reason,
    } satisfies WorkerOutMessage);
    return;
  }

  await mkdir(outDir, { recursive: true });

  let chunkCount = 0;
  let lastOutputSampleRate = 0;
  let lastChannels = 0;

  for (const yielded of splitWavFile(buffer, { mode, chunkSeconds })) {
    if (abortRequested) {
      await cleanupOrphanTmps(outDir, baseName);
      post({ kind: "aborted" } satisfies WorkerOutMessage);
      return;
    }

    if (yielded.kind === "abort") {
      await cleanupOrphanTmps(outDir, baseName);
      post({ kind: "aborted" } satisfies WorkerOutMessage);
      return;
    }

    if (yielded.kind === "error") {
      post({
        kind: "file-error",
        fileIndex,
        reason: yielded.code,
      } satisfies WorkerOutMessage);
      return;
    }

    const { chunk } = yielded;
    const chunkName = `${baseName}_${padIndex(chunk.index)}.wav`;
    const ancillaries = buildAncillaries(
      meta,
      chunk.index,
      chunk.samplesInChunk,
      chunk.outputSampleRate,
    );

    try {
      await writeTmpAndRename(outDir, chunkName, chunk.buffer, ancillaries);
    } catch (err) {
      const reason =
        err instanceof Error && "code" in err
          ? String((err as { code: unknown }).code)
          : "UNKNOWN";
      post({
        kind: "file-error",
        fileIndex,
        reason,
      } satisfies WorkerOutMessage);
      return;
    }

    post({
      kind: "chunk-written",
      fileIndex,
      chunkIndex: chunk.index,
    } satisfies WorkerOutMessage);

    chunkCount += 1;
    lastOutputSampleRate = chunk.outputSampleRate;
    lastChannels = chunk.channels;
  }

  if (abortRequested) {
    post({ kind: "aborted" } satisfies WorkerOutMessage);
    return;
  }

  post({
    kind: "file-done",
    fileIndex,
    chunkCount,
    fileSizeBytes,
    outputSampleRate: lastOutputSampleRate,
    channels: lastChannels,
  } satisfies WorkerOutMessage);
};

const cleanupOrphanTmps = async (
  outDir: string,
  baseName: string,
): Promise<void> => {
  const { readdir } = await import("node:fs/promises");
  let entries: string[];
  try {
    entries = await readdir(outDir);
  } catch {
    return;
  }
  const prefix = `${baseName}_`;
  for (const entry of entries) {
    if (entry.startsWith(prefix) && entry.endsWith(".tmp")) {
      await unlink(`${outDir}/${entry}`).catch(() => undefined);
    }
  }
};

if (port !== null) {
  const activePort = port;
  activePort.on("message", (msg: WorkerInMessage) => {
    if (msg.kind === "abort") {
      abortRequested = true;
      return;
    }
    processFile(msg).catch((err: unknown) => {
      const reason = err instanceof Error ? err.message : "UNKNOWN";
      activePort.postMessage({
        kind: "file-error",
        fileIndex: msg.fileIndex,
        reason,
      } satisfies WorkerOutMessage);
    });
  });
}
