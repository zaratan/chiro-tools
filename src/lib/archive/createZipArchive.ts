import { once } from "node:events";
import type { FileHandle } from "node:fs/promises";
import { mkdir, open, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { createDeflateRaw } from "node:zlib";
import { extractErrorCode, renameWithFallback } from "../fs/safeFsOps.js";
import type { ArchiveEntryStat } from "./planArchive.js";
import { CRC32_INITIAL, crc32Final, crc32Update } from "./crc32.js";
import {
  buildCentralDirectoryEntry,
  buildEndOfCentralDirectory,
  buildLocalFileHeader,
  buildLocalFileHeaderPatch,
  buildZip64EndOfCentralDirectory,
  buildZip64EndOfCentralDirectoryLocator,
  CRC_FIELD_OFFSET,
  MAX_UINT16,
  MAX_UINT32,
  nameBytesOf,
  needsZip64Eocd,
} from "./zipFormat.js";
import { verifyZipArchive, type ArchivePlanEntry } from "./verifyZipArchive.js";

const DEFLATE_LEVEL = 6;
const READ_CHUNK_BYTES = 1024 * 1024;
const ORPHAN_TMP_REGEX = /\.(\d+)\.tmp$/;

export type ArchiveProgressEvent =
  | {
      kind: "entry-start";
      entryIndex: number;
      entryName: string;
      totalEntries: number;
    }
  | { kind: "bytes-read"; totalBytesRead: number }
  | { kind: "entry-done"; entryIndex: number };

export type Zip64Thresholds = { offset?: number; entryCount?: number };

export type CreateZipArchiveOptions = {
  sourceDir: string;
  entries: readonly ArchiveEntryStat[];
  zipPath: string;
  signal?: AbortSignal;
  onProgress?: (event: ArchiveProgressEvent) => void;
  zip64Thresholds?: Zip64Thresholds;
  /**
   * Test-only hook, called with the `.tmp` path right after every entry has
   * been written but before `sync()`/verify — lets tests corrupt the file on
   * disk to exercise the real verify-and-discard path end to end. Never set
   * in production code. Mirrors the `workerPath`-override pattern used by
   * `splitWorkerPool.ts` for the same reason: a narrow, explicit escape
   * hatch beats mocking the filesystem.
   */
  corruptBeforeVerifyForTests?: (tmpPath: string) => Promise<void>;
};

export type CreateZipArchiveResult =
  | {
      kind: "ok";
      zipPath: string;
      zipBytes: number;
      entryCount: number;
      durationMs: number;
    }
  | { kind: "aborted" }
  | { kind: "error"; code: string };

const isAliveProcess = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH: no such process — dead, safe to clean up.
    // EPERM: exists but owned by another user — treat as alive, leave it.
    return (
      err instanceof Error &&
      "code" in err &&
      (err as { code: unknown }).code === "EPERM"
    );
  }
};

/**
 * Removes orphaned `.tmp` files left behind by a killed previous run. Only
 * touches names matching our own `<zip>.<pid>.tmp` convention, and only when
 * the embedded PID no longer corresponds to a running process — a live
 * concurrent chiro instance's tmp is left alone. Best-effort: any error
 * (e.g. permission) is swallowed by the caller.
 */
export const cleanOrphanArchiveTmp = async (
  archivedDir: string,
): Promise<void> => {
  let entries: string[];
  try {
    entries = await readdir(archivedDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const match = ORPHAN_TMP_REGEX.exec(entry);
    if (match === null) continue;
    const pidStr = match[1];
    if (pidStr === undefined) continue;
    const pid = Number.parseInt(pidStr, 10);
    if (!Number.isFinite(pid) || isAliveProcess(pid)) continue;
    await unlink(path.join(archivedDir, entry)).catch(() => undefined);
  }
};

type DeflateEntryResult =
  | {
      kind: "ok";
      crc32: number;
      compressedSize: number;
      uncompressedSize: number;
    }
  | { kind: "aborted" }
  | { kind: "error"; code: string };

/**
 * Streams `srcFh` through raw deflate, writing compressed output
 * sequentially into `targetFh` starting at `startOffset`. Reads 1 MiB blocks
 * — the AbortSignal is checked once per block, matching the granularity of
 * progress events. Deliberately not a `pipeline()`/`createWriteStream()`:
 * the destination is a shared `FileHandle` also used for the LFH, the CRC
 * patch, and every other entry, so every write goes through the same
 * explicit-offset `fh.write(buf, 0, len, position)` call, sequenced by
 * `await`, never buffered by a stream wrapper.
 */
const deflateEntry = async (params: {
  srcFh: FileHandle;
  targetFh: FileHandle;
  startOffset: number;
  signal?: AbortSignal;
  onBytesRead: (n: number) => void;
}): Promise<DeflateEntryResult> => {
  const deflater = createDeflateRaw({ level: DEFLATE_LEVEL });
  let crc = CRC32_INITIAL;
  let uncompressedSize = 0;
  let compressedSize = 0;
  let writeOffset = params.startOffset;
  let aborted = false;

  const pump = async (): Promise<void> => {
    const readBuf = Buffer.alloc(READ_CHUNK_BYTES);
    let position = 0;
    for (;;) {
      if (params.signal?.aborted === true) {
        aborted = true;
        break;
      }
      const { bytesRead } = await params.srcFh.read(
        readBuf,
        0,
        READ_CHUNK_BYTES,
        position,
      );
      if (bytesRead === 0) break;

      const chunk = Buffer.from(readBuf.subarray(0, bytesRead));
      crc = crc32Update(crc, chunk);
      uncompressedSize += bytesRead;
      position += bytesRead;
      params.onBytesRead(bytesRead);

      if (!deflater.write(chunk)) {
        await once(deflater, "drain");
      }
    }
    deflater.end();
  };

  const pumpPromise = pump();

  try {
    for await (const outChunk of deflater as AsyncIterable<Buffer>) {
      if (params.signal?.aborted === true) {
        aborted = true;
        break;
      }
      await params.targetFh.write(outChunk, 0, outChunk.length, writeOffset);
      writeOffset += outChunk.length;
      compressedSize += outChunk.length;
    }
  } catch (err) {
    await pumpPromise.catch(() => undefined);
    return { kind: "error", code: extractErrorCode(err) };
  }

  await pumpPromise.catch(() => undefined);

  if (aborted || params.signal?.aborted === true) {
    return { kind: "aborted" };
  }

  return {
    kind: "ok",
    crc32: crc32Final(crc),
    compressedSize,
    uncompressedSize,
  };
};

const isAborted = (signal?: AbortSignal): boolean => signal?.aborted === true;

/**
 * Creates a ZIP archive of `entries` (read from `sourceDir`) at `zipPath`,
 * one entry at a time, streaming raw deflate. Strictly non-destructive:
 * every read comes from `sourceDir`; the only writes/unlinks are inside
 * `zipPath`'s own directory (the `.tmp` file, then the final rename).
 *
 * Finalization order matters: `sync()` (ENOSPC can surface only here or at
 * `close()`, not at `write()`, on delayed-allocation filesystems) → verify
 * (reading before sync could validate a truncated page-cache view) →
 * `close()` → rename. Any failure along the way unlinks the `.tmp` and
 * returns a tagged error — nothing partial ever appears at `zipPath`.
 */
export const createZipArchive = async (
  opts: CreateZipArchiveOptions,
): Promise<CreateZipArchiveResult> => {
  const startedAt = performance.now();
  const signal = opts.signal;
  const archivedDir = path.dirname(opts.zipPath);

  try {
    await mkdir(archivedDir, { recursive: true });
  } catch (err) {
    return { kind: "error", code: `mkdir:${extractErrorCode(err)}` };
  }

  await cleanOrphanArchiveTmp(archivedDir).catch(() => undefined);

  if (isAborted(signal)) return { kind: "aborted" };

  const tmpPath = `${opts.zipPath}.${process.pid.toString()}.tmp`;
  const cleanupTmp = async (): Promise<void> => {
    await unlink(tmpPath).catch(() => undefined);
  };

  let targetFh: FileHandle;
  try {
    targetFh = await open(tmpPath, "w");
  } catch (err) {
    return { kind: "error", code: extractErrorCode(err) };
  }

  const offsetThreshold = opts.zip64Thresholds?.offset ?? MAX_UINT32;
  const entryCountThreshold = opts.zip64Thresholds?.entryCount ?? MAX_UINT16;

  const emit = (event: ArchiveProgressEvent): void => {
    try {
      opts.onProgress?.(event);
    } catch {
      // A buggy callback must not crash the batch.
    }
  };

  const failWith = async (code: string): Promise<CreateZipArchiveResult> => {
    await targetFh.close().catch(() => undefined);
    await cleanupTmp();
    return { kind: "error", code };
  };

  const abortRun = async (): Promise<CreateZipArchiveResult> => {
    await targetFh.close().catch(() => undefined);
    await cleanupTmp();
    return { kind: "aborted" };
  };

  try {
    const cdRecords: Buffer[] = [];
    const planEntries: ArchivePlanEntry[] = [];
    let currentOffset = 0;
    let bytesReadFromSources = 0;

    for (let index = 0; index < opts.entries.length; index++) {
      const entry = opts.entries[index];
      if (entry === undefined) continue;

      if (isAborted(signal)) return await abortRun();

      emit({
        kind: "entry-start",
        entryIndex: index,
        entryName: entry.name,
        totalEntries: opts.entries.length,
      });

      const absSource = path.join(opts.sourceDir, entry.name);

      // Re-stat immediately before open — narrows the TOCTOU window from
      // "scan to run" (minutes) down to microseconds.
      let freshStat;
      try {
        freshStat = await stat(absSource);
      } catch {
        return await failWith("file-changed");
      }
      if (freshStat.size !== entry.size) {
        return await failWith("file-changed");
      }
      if (freshStat.size >= MAX_UINT32) {
        return await failWith("entry-too-large");
      }

      const nameBytes = nameBytesOf(entry.name);
      const localHeaderOffset = currentOffset;
      const lfh = buildLocalFileHeader({
        nameBytes,
        modified: entry.mtime,
        crc32: 0,
        compressedSize: 0,
        uncompressedSize: 0,
      });
      await targetFh.write(lfh, 0, lfh.length, currentOffset);
      currentOffset += lfh.length;

      let srcFh: FileHandle;
      try {
        srcFh = await open(absSource, "r");
      } catch (err) {
        return await failWith(extractErrorCode(err));
      }

      const deflateResult = await deflateEntry({
        srcFh,
        targetFh,
        startOffset: currentOffset,
        signal,
        onBytesRead: (n) => {
          bytesReadFromSources += n;
          emit({ kind: "bytes-read", totalBytesRead: bytesReadFromSources });
        },
      });
      await srcFh.close().catch(() => undefined);

      if (deflateResult.kind === "aborted") return await abortRun();
      if (deflateResult.kind === "error") {
        return await failWith(deflateResult.code);
      }

      const {
        crc32: entryCrc,
        compressedSize,
        uncompressedSize,
      } = deflateResult;
      if (uncompressedSize !== freshStat.size) {
        return await failWith("file-changed");
      }
      currentOffset += compressedSize;

      const patch = buildLocalFileHeaderPatch(
        entryCrc,
        compressedSize,
        uncompressedSize,
      );
      await targetFh.write(
        patch,
        0,
        patch.length,
        localHeaderOffset + CRC_FIELD_OFFSET,
      );

      cdRecords.push(
        buildCentralDirectoryEntry({
          nameBytes,
          modified: entry.mtime,
          crc32: entryCrc,
          compressedSize,
          uncompressedSize,
          localHeaderOffset,
          zip64OffsetThreshold: offsetThreshold,
        }),
      );
      planEntries.push({ name: entry.name, uncompressedSize });

      emit({ kind: "entry-done", entryIndex: index });
    }

    const cdOffset = currentOffset;
    for (const record of cdRecords) {
      await targetFh.write(record, 0, record.length, currentOffset);
      currentOffset += record.length;
    }
    const cdSize = currentOffset - cdOffset;
    const entryCount = cdRecords.length;

    if (
      needsZip64Eocd(
        { entryCount, cdSize, cdOffset },
        { entryCount: entryCountThreshold, offset: offsetThreshold },
      )
    ) {
      const zip64EocdOffset = currentOffset;
      const zip64Eocd = buildZip64EndOfCentralDirectory({
        entryCount,
        cdSize,
        cdOffset,
      });
      await targetFh.write(zip64Eocd, 0, zip64Eocd.length, currentOffset);
      currentOffset += zip64Eocd.length;

      const locator = buildZip64EndOfCentralDirectoryLocator(zip64EocdOffset);
      await targetFh.write(locator, 0, locator.length, currentOffset);
      currentOffset += locator.length;
    }

    const eocd = buildEndOfCentralDirectory({ entryCount, cdSize, cdOffset });
    await targetFh.write(eocd, 0, eocd.length, currentOffset);
    currentOffset += eocd.length;

    try {
      await targetFh.sync();
    } catch (err) {
      return await failWith(extractErrorCode(err));
    }

    if (opts.corruptBeforeVerifyForTests) {
      await opts.corruptBeforeVerifyForTests(tmpPath);
    }

    const verifyResult = await verifyZipArchive(tmpPath, planEntries, {
      crcMode: "spot",
    });
    if (verifyResult.kind !== "ok") {
      return await failWith("verify-failed");
    }

    try {
      await targetFh.close();
    } catch (err) {
      await cleanupTmp();
      return { kind: "error", code: extractErrorCode(err) };
    }

    const renameResult = await renameWithFallback(tmpPath, opts.zipPath, {
      signal,
    });
    if (renameResult.kind === "error") {
      await cleanupTmp();
      return { kind: "error", code: renameResult.code };
    }

    return {
      kind: "ok",
      zipPath: opts.zipPath,
      zipBytes: currentOffset,
      entryCount,
      durationMs: performance.now() - startedAt,
    };
  } catch (err) {
    return await failWith(extractErrorCode(err));
  }
};
