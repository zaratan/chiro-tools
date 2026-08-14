import {
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { extractErrorCode } from "../fs/safeFsOps.js";
import {
  collisionNameCandidates,
  type ArchiveEntryStat,
} from "./planArchive.js";
import { buildStagingDirName, buildVolumeFileName } from "./planUpload.js";
import {
  createZipArchive,
  type ArchiveProgressEvent,
  type Zip64Thresholds,
} from "./createZipArchive.js";
import { maxVolumeBytes } from "./maxVolumeBytes.js";

/**
 * `ArchiveProgressEvent` plus a volume boundary marker. Declared here, not
 * in `createZipArchive.ts` — the single writer never emits it, only the
 * orchestrator that sequences several writer calls into one series does.
 */
export type VolumeProgressEvent =
  ArchiveProgressEvent | { kind: "volume-start"; volumeIndex: number };

export type ArchivedVolume = {
  fileName: string;
  zipBytes: number;
  entryCount: number;
};

export type CreateZipVolumesOptions = {
  sourceDir: string;
  entries: readonly ArchiveEntryStat[];
  uploadDir: string;
  /**
   * The series' base name before any commit-time collision suffix (e.g.
   * `Car340581-2026-Pass1-A1_20260814` or `depot_20260814` — see
   * `buildSeriesDirName`). Volume file names are always derived from this
   * pre-collision name, never from the eventually-committed
   * `seriesDirName` in the result, which may carry a `-2` suffix.
   */
  seriesDirName: string;
  signal?: AbortSignal;
  onProgress?: (event: VolumeProgressEvent) => void;
  /** Forwarded to every per-volume `createZipArchive` call — test-only, so
   * the ZIP64 guard can be exercised without a multi-GB fixture. */
  zip64Thresholds?: Zip64Thresholds;
};

export type CreateZipVolumesResult =
  | {
      kind: "ok";
      seriesDirPath: string;
      seriesDirName: string;
      volumes: ArchivedVolume[];
      entryCount: number;
      totalZipBytes: number;
      durationMs: number;
      /** Best-effort — see D4 bis in the phase-9 plan. `true` only if both
       * the staging-dir fsync (before commit) and the `uploadDir` fsync
       * (after commit) succeeded. */
      durable: boolean;
    }
  | { kind: "aborted" }
  | { kind: "error"; code: string };

const isAborted = (signal?: AbortSignal): boolean => signal?.aborted === true;

/** Best-effort fsync of a directory — mirrors `createZipArchive.ts`'s
 * private helper of the same shape; kept as a separate small copy rather
 * than importing it, since this sub-phase deliberately leaves
 * `createZipArchive.ts` untouched. */
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

const sumSizes = (entries: readonly ArchiveEntryStat[]): number =>
  entries.reduce((sum, e) => sum + e.size, 0);

/**
 * Re-offsets one volume's `ArchiveProgressEvent`s into series-global
 * coordinates before handing them to the caller's `onProgress`. `entryIndex`
 * shifts by the count of entries already written in prior (closed) volumes;
 * `totalBytesRead` shifts by the sum of *entry sizes* of those same prior
 * volumes — never by the last `totalBytesRead` observed, which would double
 * count once a volume's own count resets to 0 at the start of the next
 * `createZipArchive` call. This works without touching
 * `useArchiveProgressState` because that hook already ignores
 * `event.totalEntries` and reads `entries.length` from its own props — do
 * not "fix" that by propagating a totalEntries here; it would silently
 * break the global count.
 */
const reoffsetProgress = (
  entryIndexBase: number,
  bytesBase: number,
  onProgress: ((event: VolumeProgressEvent) => void) | undefined,
): ((event: ArchiveProgressEvent) => void) => {
  return (event) => {
    if (onProgress === undefined) return;
    if (event.kind === "bytes-read") {
      onProgress({
        kind: "bytes-read",
        totalBytesRead: bytesBase + event.totalBytesRead,
      });
    } else {
      onProgress({ ...event, entryIndex: entryIndexBase + event.entryIndex });
    }
  };
};

const removeDirRecursiveBestEffort = async (dir: string): Promise<void> => {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
};

/** A buggy callback must not crash the batch — mirrors `createZipArchive.ts`'s
 * `emit` wrapper. */
const emitVolumeStart = (
  onProgress: ((event: VolumeProgressEvent) => void) | undefined,
  volumeIndex: number,
): void => {
  try {
    onProgress?.({ kind: "volume-start", volumeIndex });
  } catch {
    // ignore
  }
};

/**
 * Creates a series of ZIP64-free volumes of `entries` (read from
 * `sourceDir`), each capped at `maxVolumeBytes()`, published as a dated
 * directory under `uploadDir`. See D1/D2/D5/D6 in the phase-9 plan for the
 * full rationale; summary of the flow:
 *
 * 1. Write volumes one at a time into a hidden per-run staging directory,
 *    advancing to a new volume on `"volume-full"`.
 *
 *    A single entry larger than the cap lands alone in its own volume, which
 *    then exceeds `maxVolumeBytes()`. That is deliberate: refusing it would
 *    block the whole deposit over one file, whereas an oversized volume is
 *    still perfectly depositable. Unreachable in practice (chunks top out at
 *    ~25 MB against a 3.5 GiB cap) — only a lowered `CHIRO_MAX_VOLUME_BYTES`
 *    or a foreign file dropped into `processed/` gets there. The ZIP64
 *    guarantee is unaffected: `zip64: "forbid"` still fails the run before
 *    writing anything past 4 GiB.
 * 2. Once the series is complete, verify it covers `entries` exactly (D5),
 *    rename each volume to its final `partN` name, `fsync` the staging dir,
 *    then commit with a single `rename` into `uploadDir` — looping over
 *    `collisionNameCandidates` on `EEXIST`/`ENOTEMPTY` (D2), never
 *    `renameWithFallback` (its EXDEV repli does a `copyFile`, which is
 *    structurally wrong for a directory).
 *
 * Any non-`"ok"` outcome destroys the staging directory before returning —
 * `uploadDir` never contains a partial series.
 */
export const createZipVolumes = async (
  opts: CreateZipVolumesOptions,
): Promise<CreateZipVolumesResult> => {
  const startedAt = performance.now();
  const signal = opts.signal;

  try {
    await mkdir(opts.uploadDir, { recursive: true });
  } catch (err) {
    return { kind: "error", code: `mkdir:${extractErrorCode(err)}` };
  }

  const stagingDirName = buildStagingDirName(opts.seriesDirName, process.pid);
  const stagingDirPath = path.join(opts.uploadDir, stagingDirName);

  try {
    await mkdir(stagingDirPath, { recursive: true });
  } catch (err) {
    return { kind: "error", code: `mkdir:${extractErrorCode(err)}` };
  }

  if (isAborted(signal)) {
    await removeDirRecursiveBestEffort(stagingDirPath);
    return { kind: "aborted" };
  }

  type ProvisionalVolume = {
    provisionalPath: string;
    zipBytes: number;
    entryCount: number;
    names: string[];
  };
  const provisionalVolumes: ProvisionalVolume[] = [];

  let remaining = opts.entries;
  let entriesWrittenSoFar = 0;
  let bytesOfClosedVolumes = 0;
  let volumeIndex = 1;
  let overallDurable = true;

  for (;;) {
    if (isAborted(signal)) {
      await removeDirRecursiveBestEffort(stagingDirPath);
      return { kind: "aborted" };
    }

    emitVolumeStart(opts.onProgress, volumeIndex);

    const provisionalPath = path.join(
      stagingDirPath,
      `volume-${volumeIndex.toString()}.zip`,
    );

    const result = await createZipArchive({
      sourceDir: opts.sourceDir,
      entries: remaining,
      zipPath: provisionalPath,
      signal,
      maxBytes: maxVolumeBytes(),
      zip64: "forbid",
      zip64Thresholds: opts.zip64Thresholds,
      onProgress: reoffsetProgress(
        entriesWrittenSoFar,
        bytesOfClosedVolumes,
        opts.onProgress,
      ),
    });

    if (result.kind === "aborted") {
      await removeDirRecursiveBestEffort(stagingDirPath);
      return { kind: "aborted" };
    }
    if (result.kind === "error") {
      await removeDirRecursiveBestEffort(stagingDirPath);
      return { kind: "error", code: result.code };
    }

    overallDurable = overallDurable && result.durable === true;

    if (result.kind === "volume-full") {
      const writtenSlice = remaining.slice(0, result.entriesWritten);
      provisionalVolumes.push({
        provisionalPath,
        zipBytes: result.zipBytes,
        entryCount: result.entryCount,
        names: writtenSlice.map((e) => e.name),
      });
      entriesWrittenSoFar += result.entriesWritten;
      bytesOfClosedVolumes += sumSizes(writtenSlice);
      remaining = remaining.slice(result.entriesWritten);
      volumeIndex++;
      continue;
    }

    // "ok" — the last volume; every remaining entry landed in it.
    provisionalVolumes.push({
      provisionalPath,
      zipBytes: result.zipBytes,
      entryCount: result.entryCount,
      names: remaining.map((e) => e.name),
    });
    break;
  }

  // D5 — completeness of the series, anchored on `opts.entries` (never on
  // the loop's own bookkeeping alone): the reported entry counts must sum to
  // exactly `entries.length`, AND the union of names handed into each volume
  // must equal the source name set exactly. Each volume's own `entryCount`
  // and archived-name set are already independently verified against what
  // that call was asked to write by `createZipArchive`'s own `finalize`, so
  // this closes the remaining gap: nothing so far checked that the *union*
  // of volumes covers the *whole* series.
  const totalEntryCount = provisionalVolumes.reduce(
    (sum, v) => sum + v.entryCount,
    0,
  );
  const writtenNames = new Set(provisionalVolumes.flatMap((v) => v.names));
  const sourceNames = new Set(opts.entries.map((e) => e.name));
  const namesMatch =
    writtenNames.size === sourceNames.size &&
    [...sourceNames].every((n) => writtenNames.has(n));
  if (totalEntryCount !== opts.entries.length || !namesMatch) {
    await removeDirRecursiveBestEffort(stagingDirPath);
    return { kind: "error", code: "verify-failed" };
  }

  const totalVolumes = provisionalVolumes.length;
  const finalVolumes: ArchivedVolume[] = [];
  for (let i = 0; i < provisionalVolumes.length; i++) {
    const volume = provisionalVolumes[i];
    if (volume === undefined) continue;
    const finalName = buildVolumeFileName(
      opts.seriesDirName,
      i + 1,
      totalVolumes,
    );
    const finalPath = path.join(stagingDirPath, finalName);
    try {
      await rename(volume.provisionalPath, finalPath);
    } catch (err) {
      await removeDirRecursiveBestEffort(stagingDirPath);
      return { kind: "error", code: `rename-volume:${extractErrorCode(err)}` };
    }
    finalVolumes.push({
      fileName: finalName,
      zipBytes: volume.zipBytes,
      entryCount: volume.entryCount,
    });
  }

  const durableStaging = await fsyncDirBestEffort(stagingDirPath);

  let committedName: string | null = null;
  for (const candidate of collisionNameCandidates(opts.seriesDirName)) {
    const candidatePath = path.join(opts.uploadDir, candidate);
    try {
      await rename(stagingDirPath, candidatePath);
      committedName = candidate;
      break;
    } catch (err) {
      const code = extractErrorCode(err);
      if (code === "EEXIST" || code === "ENOTEMPTY") continue;
      await removeDirRecursiveBestEffort(stagingDirPath);
      return { kind: "error", code };
    }
  }

  if (committedName === null) {
    await removeDirRecursiveBestEffort(stagingDirPath);
    return { kind: "error", code: "collision-exhausted" };
  }

  const durableUpload = await fsyncDirBestEffort(opts.uploadDir);

  return {
    kind: "ok",
    seriesDirPath: path.join(opts.uploadDir, committedName),
    seriesDirName: committedName,
    volumes: finalVolumes,
    entryCount: totalEntryCount,
    totalZipBytes: finalVolumes.reduce((sum, v) => sum + v.zipBytes, 0),
    durationMs: performance.now() - startedAt,
    durable: durableStaging && durableUpload && overallDurable,
  };
};

const STAGING_ORPHAN_REGEX = /^\.(.+)\.(\d+)\.tmpdir$/;
const ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

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
 * Removes a staging directory's contents by name, one file at a time, never
 * `rm(..., {recursive: true})` — this is the first directory deletion the
 * archive module performs on a path derived from the user's own folder, so
 * it only ever removes the exact kinds of entries this module itself
 * creates inside a staging dir (finished volumes, or a stray
 * `createZipArchive` `.tmp` left by a kill mid-volume). Anything else is
 * left alone, which then makes the final `rmdir` fail `ENOTEMPTY` rather
 * than silently eating unknown content — caught and treated as "give up,
 * leave it in place".
 */
const removeStagingDirConservatively = async (
  dirPath: string,
): Promise<void> => {
  let children: string[];
  try {
    children = await readdir(dirPath);
  } catch {
    return;
  }
  for (const child of children) {
    if (!child.endsWith(".zip") && !child.endsWith(".tmp")) continue;
    await unlink(path.join(dirPath, child)).catch(() => undefined);
  }
  await rmdir(dirPath).catch(() => undefined);
};

/**
 * Removes orphaned staging directories left behind by a killed previous
 * `createZipVolumes` run — the upload-series mirror of
 * `createZipArchive.ts`'s `cleanOrphanArchiveTmp`, plus an age guard PIDs
 * alone can't provide: PIDs get recycled, so a `kill -9` followed by
 * reassignment would otherwise leave a staging directory (potentially
 * several GiB) that liveness checks alone would never flag as dead.
 *
 * Only entries directly inside `uploadDir` matching `^\..+\.\d+\.tmpdir$`
 * are considered; `lstat` + `isDirectory()` so a symlink is never followed.
 * A candidate is removed when its embedded PID is no longer alive OR its
 * `mtime` is older than 24h — whichever comes first. Best-effort: no error
 * ever propagates to the caller. Called at "constat" time (the screen
 * already says "Analyse du dossier…"), never mid-run, where it would freeze
 * the UI right after the user pressed Enter.
 */
export const cleanOrphanStagingDirs = async (
  uploadDir: string,
): Promise<void> => {
  let entries: string[];
  try {
    entries = await readdir(uploadDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const match = STAGING_ORPHAN_REGEX.exec(entry);
    if (match === null) continue;
    const pidStr = match[2];
    const entryPath = path.join(uploadDir, entry);

    let stats;
    try {
      stats = await lstat(entryPath);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) continue;

    const pid = pidStr === undefined ? NaN : Number.parseInt(pidStr, 10);
    const dead = !Number.isFinite(pid) || !isAliveProcess(pid);
    const old = Date.now() - stats.mtime.getTime() > ORPHAN_MAX_AGE_MS;
    if (!dead && !old) continue;

    await removeStagingDirConservatively(entryPath);
  }
};
