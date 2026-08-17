import {
  lstat,
  mkdir,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { isVisibleNonTmpEntry } from "../fs/scanDirectory.js";
import {
  extractErrorCode,
  fsyncDirBestEffort,
  isAliveProcess,
} from "../fs/safeFsOps.js";
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
      /** Best-effort. `true` only if both
       * the staging-dir fsync (before commit) and the `uploadDir` fsync
       * (after commit) succeeded. */
      durable: boolean;
    }
  | { kind: "aborted" }
  | { kind: "error"; code: string };

const isAborted = (signal?: AbortSignal): boolean => signal?.aborted === true;

const sumSizes = (entries: readonly ArchiveEntryStat[]): number =>
  entries.reduce((sum, e) => sum + e.size, 0);

/**
 * Re-offsets one volume's `ArchiveProgressEvent`s into series-global
 * coordinates before handing them to the caller's `onProgress`. `entryIndex`
 * shifts by the count of entries already written in prior (closed) volumes;
 * `totalBytesRead` shifts by the sum of *entry sizes* of those same prior
 * volumes — never by the last `totalBytesRead` observed, which would double
 * count once a volume's own count resets to 0 at the start of the next
 * `createZipArchive` call. No total has to be re-offset: the event carries
 * none since the phase-9 review removed `totalEntries`, and
 * `useArchiveProgressState` reads `entries.length` from its own props.
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
 * directory under `uploadDir`. Summary of the flow:
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

  // Deliberately NOT `recursive: true`, which silently adopts a pre-existing
  // directory. The staging name derives only from the series and our own PID,
  // so it is identical across two attempts in the same process — and
  // `cleanOrphanStagingDirs` exempts live PIDs, including ours. A leftover
  // from a failed attempt (its cleanup is best-effort) or from a dead process
  // whose PID was reused would therefore be adopted, and its stale volumes
  // published by the commit rename below: the result screen would announce
  // fewer files than the folder actually contains, and she would deposit
  // duplicates on the portal. Clear the residue and create it once more —
  // failing outright would break a legitimate retry.
  try {
    await mkdir(stagingDirPath);
  } catch (err) {
    if (extractErrorCode(err) !== "EEXIST") {
      return { kind: "error", code: `mkdir:${extractErrorCode(err)}` };
    }
    await removeDirRecursiveBestEffort(stagingDirPath);
    try {
      await mkdir(stagingDirPath);
    } catch {
      // The cleanup above is best-effort and swallows its own failure, so a
      // second EEXIST means the residue is still there and we could not
      // remove it. Reporting `mkdir:EEXIST` would be doubly wrong: the
      // message would blame the target directory (which exists and is fine),
      // and the code would classify as transient — so every retry would
      // re-run the cleanup that just failed, identically, forever, on a
      // directory she cannot see because its name starts with a dot. Its own
      // code, definitive, naming the thing to delete.
      return { kind: "error", code: "staging-stuck" };
    }
  }

  if (isAborted(signal)) {
    await removeDirRecursiveBestEffort(stagingDirPath);
    return { kind: "aborted" };
  }

  type ProvisionalVolume = {
    provisionalPath: string;
    zipBytes: number;
    entryCount: number;
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

    overallDurable = overallDurable && result.durable;

    if (result.kind === "volume-full") {
      const writtenSlice = remaining.slice(0, result.entriesWritten);
      provisionalVolumes.push({
        provisionalPath,
        zipBytes: result.zipBytes,
        entryCount: result.entryCount,
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
    });
    break;
  }

  // Each volume has already proven it holds exactly the slice it was handed
  // (`createZipArchive`'s own completeness check, itself confirmed against
  // the re-read central directory by `verifyZipArchive`). What no volume can
  // see is whether the slices this loop handed out add up: a bug in the
  // `entriesWritten` arithmetic would give every volume a consistent story
  // and still drop a recording. Comparing the counts is the whole check —
  // comparing the *names* would not add anything, since the loop derives
  // them from the same slicing it is being audited on.
  const totalEntryCount = provisionalVolumes.reduce(
    (sum, v) => sum + v.entryCount,
    0,
  );
  if (totalEntryCount !== opts.entries.length) {
    await removeDirRecursiveBestEffort(stagingDirPath);
    return { kind: "error", code: "verify-failed:entry-count" };
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

  // Symmetric to the completeness check above, in the other direction: that
  // one proves no entry is missing, this one proves no *file* is extra. The
  // commit below publishes the directory wholesale, so anything sitting in it
  // that this run did not just write would ship with the series — and a stale
  // `<série>_part9.zip` is a perfectly valid zip, indistinguishable from a
  // real one once deposited. Anchored on the directory itself, never on what
  // the loop believes it wrote.
  let stagedFiles: string[];
  try {
    stagedFiles = await readdir(stagingDirPath);
  } catch {
    await removeDirRecursiveBestEffort(stagingDirPath);
    return { kind: "error", code: "verify-failed:staging-unreadable" };
  }
  // Only `.zip` entries: the whole point is that no *stale volume* ships with
  // the series, and a stale volume is a zip. Rejecting any unexpected name
  // would also fail the run on a `.DS_Store` the Finder drops the moment she
  // opens `upload/` to watch progress — destroying the staging and costing
  // fifteen minutes, under a message about completeness. Filtering keeps the
  // whole safety property and drops that entire class of false positive.
  // `isVisibleNonTmpEntry` on top of the `.zip` suffix, and the dot-prefix
  // half is the load-bearing one: on a filesystem without native extended
  // attributes — exFAT, which is what an external drive shared with a PC is
  // formatted as — macOS writes an AppleDouble sidecar `._<name>` next to
  // every file. That sidecar *keeps the original extension*, so
  // `._<série>_part1.zip` sails through a suffix-only filter and the count
  // comes out one too high, per volume. The run then destroys its own staging
  // and reports an incomplete series, after fifteen minutes of work, on a
  // series that was in fact perfect. Reported from the field on
  // `/Volumes/NOOX_DD` and reproduced on an exFAT image: 5/5 runs failed, and
  // a single run failed just the same — concurrency was never involved.
  const expectedFiles = new Set(finalVolumes.map((v) => v.fileName));
  const stagedZips = stagedFiles.filter(
    (name) => isVisibleNonTmpEntry(name) && name.endsWith(".zip"),
  );
  const filesMatch =
    stagedZips.length === expectedFiles.size &&
    stagedZips.every((name) => expectedFiles.has(name));
  if (!filesMatch) {
    await removeDirRecursiveBestEffort(stagingDirPath);
    return { kind: "error", code: "verify-failed:staged-files" };
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
