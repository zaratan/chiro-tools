import { once } from "node:events";
import type { FileHandle } from "node:fs/promises";
import { mkdir, open, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { createDeflateRaw } from "node:zlib";
import { extractErrorCode, renameWithFallback } from "../fs/safeFsOps.js";
import { deflateBound } from "./deflateBound.js";
import type { ArchiveEntryStat } from "./planArchive.js";
import { CRC32_INITIAL, crc32Final, crc32Update } from "./crc32.js";
import {
  buildCentralDirectoryEntry,
  buildEndOfCentralDirectory,
  buildLocalFileHeader,
  buildLocalFileHeaderPatch,
  buildZip64EndOfCentralDirectory,
  buildZip64EndOfCentralDirectoryLocator,
  CD_FIXED_SIZE,
  CRC_FIELD_OFFSET,
  EOCD_FIXED_SIZE,
  LFH_FIXED_SIZE,
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
   * Defaults to "allow". "forbid" fails the run with `zip64-required`
   * instead of ever writing ZIP64 structures — for the Vigie-Chiro upload
   * portal, which rejects ZIP64. The backup flow (single big zip,
   * `useArchiveRun.ts`) never sets this and keeps its current ZIP64-nominal
   * behavior.
   */
  zip64?: "allow" | "forbid";
  /**
   * Caps the real, on-disk size of this one zip. Once admitting the next
   * entry would risk crossing it, the archive is finalized early and
   * `"volume-full"` is returned instead of `"ok"` — the caller is expected
   * to retry with the remaining entries at a new `zipPath`.
   */
  maxBytes?: number;
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
      /**
       * Whether the archived directory was fsync'd after the rename —
       * best-effort, never fails the run either way. Optional in the type
       * so existing call sites/literals that predate this field keep
       * compiling; the real implementation always sets a real boolean.
       */
      durable?: boolean;
    }
  | { kind: "aborted" }
  | { kind: "error"; code: string };

/**
 * `CreateZipArchiveResult` plus `"volume-full"`, returned only when the
 * caller opts into `maxBytes`. Kept as a separate type (rather than adding
 * the member directly to `CreateZipArchiveResult`) so every existing call
 * site and test literal typed as `CreateZipArchiveResult` — none of which
 * pass `maxBytes` — keeps compiling unchanged; see the overloads below.
 */
export type CreateZipArchiveVolumeResult =
  | CreateZipArchiveResult
  | {
      kind: "volume-full";
      entriesWritten: number;
      zipPath: string;
      zipBytes: number;
      entryCount: number;
      durationMs: number;
      durable?: boolean;
    };

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

const isAborted = (signal?: AbortSignal): boolean => signal?.aborted === true;

/**
 * Best-effort fsync of a directory (e.g. after a rename lands a new file in
 * it) — never throws, `false` just means the durability guarantee wasn't
 * obtained. Purely a durability guarantee for a *future* destructive flow
 * (deleting `processed/` after archiving), not a correctness requirement
 * today: a failed fsync here never turns a successful rename into a failure.
 */
const fsyncDirBestEffort = async (dir: string): Promise<boolean> => {
  try {
    const dirFh = await open(dir, "r");
    try {
      await dirFh.sync();
    } finally {
      await dirFh.close();
    }
    return true;
  } catch {
    return false;
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

  // Both loops must be able to end the other one, or the app freezes with no
  // way out: the consumer below awaits the deflater's end, and `runningRef`
  // keeps the global Ctrl+C disabled while a run is in flight. So a read
  // failure destroys the stream (surfacing as a rejection in the consumer's
  // for-await) rather than returning silently, and every resumption point
  // re-checks both the signal and whether the stream is already gone.
  // `deflater.destroyed` flips from another async task, which tseslint cannot
  // see across an await — same narrowing limitation as `signal?.aborted` in a
  // generator (cf. CLAUDE.md). Read it through a helper.
  const streamGone = (): boolean => deflater.destroyed;

  const pump = async (): Promise<void> => {
    const readBuf = Buffer.alloc(READ_CHUNK_BYTES);
    let position = 0;
    try {
      for (;;) {
        if (isAborted(params.signal) || streamGone()) {
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

        // The consumer may have broken out (abort) while we were reading —
        // writing to a destroyed stream never drains, and never errors.
        if (isAborted(params.signal) || streamGone()) {
          aborted = true;
          break;
        }

        const chunk = Buffer.from(readBuf.subarray(0, bytesRead));
        crc = crc32Update(crc, chunk);
        uncompressedSize += bytesRead;
        position += bytesRead;
        params.onBytesRead(bytesRead);

        if (!deflater.write(chunk)) {
          await once(deflater, "drain");
        }
      }
    } catch (err) {
      deflater.destroy(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    if (!streamGone()) deflater.end();
  };

  const pumpPromise = pump();

  try {
    for await (const outChunk of deflater as AsyncIterable<Buffer>) {
      if (isAborted(params.signal)) {
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

  if (aborted || isAborted(params.signal)) {
    return { kind: "aborted" };
  }

  return {
    kind: "ok",
    crc32: crc32Final(crc),
    compressedSize,
    uncompressedSize,
  };
};

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
 *
 * Two overloads keyed on `maxBytes` presence: existing call sites, which
 * never pass it, get the narrow `CreateZipArchiveResult` return type
 * unchanged; only a caller who opts into `maxBytes` sees `"volume-full"` in
 * its type.
 */
export function createZipArchive(
  opts: CreateZipArchiveOptions & { maxBytes?: undefined },
): Promise<CreateZipArchiveResult>;
export function createZipArchive(
  opts: CreateZipArchiveOptions & { maxBytes: number | undefined },
): Promise<CreateZipArchiveVolumeResult>;
export async function createZipArchive(
  opts: CreateZipArchiveOptions,
): Promise<CreateZipArchiveVolumeResult> {
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
  const zip64Mode = opts.zip64 ?? "allow";

  const emit = (event: ArchiveProgressEvent): void => {
    try {
      opts.onProgress?.(event);
    } catch {
      // A buggy callback must not crash the batch.
    }
  };

  const failWith = async (
    code: string,
  ): Promise<CreateZipArchiveResult & { kind: "error" }> => {
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
    if (
      zip64Mode === "forbid" &&
      opts.maxBytes === undefined &&
      opts.entries.length >= entryCountThreshold
    ) {
      // Guard 0 — the only guard that can see the entry-count trigger; the
      // per-entry offset guard (guard 2, below) structurally cannot. Skipped
      // when `maxBytes` is set: `opts.entries` is then the *remaining* pool
      // handed to every volume by the 9.B orchestrator, not what this one
      // volume will actually write — the loop-level check below (which sees
      // each volume's real entry count) is guard 0's replacement in that
      // case.
      return await failWith("zip64-required");
    }

    const cdRecords: Buffer[] = [];
    const planEntries: ArchivePlanEntry[] = [];
    let currentOffset = 0;
    let bytesReadFromSources = 0;

    /**
     * Shared tail: writes the central directory (+ ZIP64 EOCD/locator if
     * needed) and classic EOCD, syncs, verifies against `expectedNames`,
     * closes, and renames into place. Used both for the natural end-of-loop
     * close and for an early `maxBytes` cutoff — `expectedNames` is a
     * parameter rather than always `opts.entries` because an early cutoff
     * only ever asked for a slice of them; see the two call sites.
     */
    const finalize = async (
      expectedNames: ReadonlySet<string>,
    ): Promise<
      | { kind: "ok"; zipBytes: number; entryCount: number; durable: boolean }
      | { kind: "aborted" }
      | { kind: "error"; code: string }
    > => {
      const cdOffset = currentOffset;
      const cdSize = cdRecords.reduce((sum, r) => sum + r.length, 0);
      const entryCount = cdRecords.length;

      const needsZip64 = needsZip64Eocd(
        { entryCount, cdSize, cdOffset },
        { entryCount: entryCountThreshold, offset: offsetThreshold },
      );
      if (zip64Mode === "forbid" && needsZip64) {
        // Guard 3 — nothing has been written to the CD/EOCD region yet.
        return await failWith("zip64-required");
      }

      let offset = currentOffset;
      for (const record of cdRecords) {
        await targetFh.write(record, 0, record.length, offset);
        offset += record.length;
      }

      if (needsZip64) {
        const zip64EocdOffset = offset;
        const zip64Eocd = buildZip64EndOfCentralDirectory({
          entryCount,
          cdSize,
          cdOffset,
        });
        await targetFh.write(zip64Eocd, 0, zip64Eocd.length, offset);
        offset += zip64Eocd.length;

        const locator = buildZip64EndOfCentralDirectoryLocator(zip64EocdOffset);
        await targetFh.write(locator, 0, locator.length, offset);
        offset += locator.length;
      }

      const eocd = buildEndOfCentralDirectory({ entryCount, cdSize, cdOffset });
      await targetFh.write(eocd, 0, eocd.length, offset);
      offset += eocd.length;

      try {
        await targetFh.sync();
      } catch (err) {
        return await failWith(extractErrorCode(err));
      }

      if (opts.corruptBeforeVerifyForTests) {
        await opts.corruptBeforeVerifyForTests(tmpPath);
      }

      // `planEntries` is built by the write loop, so verifying against it
      // alone would be self-referential: an entry silently skipped above
      // would be missing from BOTH the archive and the reference, and every
      // check would still pass. Anchor completeness on what the caller
      // asked for instead — this is the guarantee a future "delete
      // processed/ after archiving" flow has to stand on.
      const archivedNames = new Set(planEntries.map((e) => e.name));
      const missing = [...expectedNames].filter((n) => !archivedNames.has(n));
      if (missing.length > 0 || archivedNames.size !== expectedNames.size) {
        return await failWith("verify-failed");
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
        // A Ctrl+C landing in the short un-abortable tail (verify → close →
        // rename) comes back as ABORT_ERR. That is an interruption, not a
        // failure: reporting it as an error would show her a raw ABORT_ERR
        // code with no French explanation for something she just asked for.
        if (renameResult.code === "ABORT_ERR" || isAborted(signal)) {
          return { kind: "aborted" };
        }
        return { kind: "error", code: renameResult.code };
      }

      const durable = await fsyncDirBestEffort(path.dirname(opts.zipPath));
      return { kind: "ok", zipBytes: offset, entryCount, durable };
    };

    for (let index = 0; index < opts.entries.length; index++) {
      const entry = opts.entries[index];
      if (entry === undefined) continue;

      if (isAborted(signal)) return await abortRun();

      const nameBytes = nameBytesOf(entry.name);

      if (opts.maxBytes !== undefined && index > 0) {
        // The first entry admitted into any given call always proceeds
        // regardless of `maxBytes` — an oversized-single-entry edge case is
        // explicitly out of scope here (belongs to the 9.B orchestrator).
        const priorCdBytes = cdRecords.reduce((sum, r) => sum + r.length, 0);
        const estimatedFootprint =
          LFH_FIXED_SIZE +
          nameBytes.length +
          deflateBound(entry.size) +
          CD_FIXED_SIZE +
          nameBytes.length;
        // `priorCdBytes` (the exact size of CD records already built for
        // entries admitted so far) and `EOCD_FIXED_SIZE` are included on
        // top of `currentOffset` + this entry's own footprint — omitting
        // them would let the real on-disk volume creep past `maxBytes` with
        // many small entries, since CD records are only physically written
        // at `finalize` time and don't show up in `currentOffset` yet.
        const wouldExceedBytes =
          currentOffset + priorCdBytes + estimatedFootprint + EOCD_FIXED_SIZE >
          opts.maxBytes;
        // Guard 0 above only sees `opts.entries.length`, which under
        // `maxBytes` is the whole remaining pool, not this volume's real
        // count — so the entry-count threshold has to be re-checked here,
        // per volume, against what this call has actually admitted so far.
        const wouldExceedEntryCount =
          zip64Mode === "forbid" && cdRecords.length + 1 >= entryCountThreshold;
        if (wouldExceedBytes || wouldExceedEntryCount) {
          const expectedNames = new Set(
            opts.entries.slice(0, index).map((e) => e.name),
          );
          const closed = await finalize(expectedNames);
          if (closed.kind !== "ok") return closed;
          return {
            kind: "volume-full",
            entriesWritten: index,
            zipPath: opts.zipPath,
            zipBytes: closed.zipBytes,
            entryCount: closed.entryCount,
            durationMs: performance.now() - startedAt,
            durable: closed.durable,
          };
        }
      }

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

      const localHeaderOffset = currentOffset;
      if (zip64Mode === "forbid" && localHeaderOffset >= offsetThreshold) {
        // Guard 2 — per-entry offset check.
        return await failWith("zip64-required");
      }

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

    const finalResult = await finalize(
      new Set(opts.entries.map((e) => e.name)),
    );
    if (finalResult.kind !== "ok") return finalResult;
    return {
      kind: "ok",
      zipPath: opts.zipPath,
      zipBytes: finalResult.zipBytes,
      entryCount: finalResult.entryCount,
      durationMs: performance.now() - startedAt,
      durable: finalResult.durable,
    };
  } catch (err) {
    return await failWith(extractErrorCode(err));
  }
}
