import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { extractErrorCode } from "../fs/safeFsOps.js";
import { isVisibleNonTmpEntry } from "../fs/scanDirectory.js";

export const ARCHIVED_DIRNAME = "archived";

/** Relative-path form shown to the user in the TUI (e.g. "./archived/"). */
export const ARCHIVED_DIR_DISPLAY = `./${ARCHIVED_DIRNAME}/`;

export const buildArchivedDir = (dir: string): string =>
  path.join(dir, ARCHIVED_DIRNAME);

const pad2 = (n: number): string => n.toString().padStart(2, "0");

/**
 * `YYYYMMDD` for a (local-time) date, day granularity only — shared by every
 * name builder that stamps a date (`buildArchiveName` here,
 * `buildSeriesDirName` in `planUpload.ts`) so the format lives in exactly
 * one place.
 */
export const formatDateStamp = (date: Date): string =>
  `${date.getFullYear().toString()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`;

/**
 * Builds the archive file name from a (local-time) date: `{prefix}_
 * YYYYMMDD.zip`, day granularity only — more meaningful for "which study,
 * roughly when" than a minute-stamped name. `prefix` defaults to
 * `"processed"` (the existing backup-zip flow, `useArchiveRun.ts`, never
 * passes one). A same-day collision falls through to `resolveFreeName`'s
 * `-2`..`-99` suffix logic, unchanged. Pure — the caller supplies `date` so
 * the "now" moment is a single decision made once by the orchestrator, not
 * re-read here.
 */
export const buildArchiveName = (
  date: Date,
  prefix: string | null = null,
): string => `${prefix ?? "processed"}_${formatDateStamp(date)}.zip`;

const MAX_COLLISION_SUFFIX = 99;
const FIRST_COLLISION_SUFFIX = 2;

export type ResolveFreeNameResult =
  { kind: "ok"; fileName: string } | { kind: "collision-exhausted" };

/** Kept as an alias so pre-9.B call sites/imports keep compiling unchanged —
 * same type as {@link ResolveFreeNameResult}. Not `@deprecated`: it isn't
 * slated for removal, `useArchiveRun.ts` (single-zip backup flow) keeps
 * using this name deliberately, and `@deprecated` would flag every one of
 * its call sites as a lint error. */
export type ResolveArchiveFileNameResult = ResolveFreeNameResult;

/**
 * Yields `baseName` itself, then `-2` through `-99` suffixes inserted before
 * its extension — or appended directly when `baseName` has none, e.g. a bare
 * directory name like `depot_20260814` (`path.extname` returns `""` for
 * those). The single source of truth for chiro's collision-suffix rule:
 * `resolveFreeName` below consumes it for access-based lookups, and
 * `createZipVolumes`'s commit step (9.B) consumes it directly to drive a
 * loop of real `rename` attempts instead — see D2 in the phase-9 plan for
 * why a directory-to-directory commit can't be resolved by pre-checking
 * existence. The range is generous — `collision-exhausted` exists for
 * no-throw exhaustiveness, not because it's expected to be reached.
 */
export function* collisionNameCandidates(baseName: string): Generator<string> {
  yield baseName;
  const ext = path.extname(baseName);
  const stem = baseName.slice(0, baseName.length - ext.length);
  for (
    let suffix = FIRST_COLLISION_SUFFIX;
    suffix <= MAX_COLLISION_SUFFIX;
    suffix++
  ) {
    yield `${stem}-${suffix.toString()}${ext}`;
  }
}

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Resolves a non-colliding name inside `dir` for `baseName` (a file name
 * like `processed_20260812.zip`, or a bare directory name): the base name
 * itself if free, otherwise the first free `collisionNameCandidates` suffix.
 * Generalized out of the original archive-filename-only resolver so any
 * access-based "what name is free" call site shares the single -2..-99 rule.
 */
export const resolveFreeName = async (
  dir: string,
  baseName: string,
): Promise<ResolveFreeNameResult> => {
  for (const candidate of collisionNameCandidates(baseName)) {
    if (!(await pathExists(path.join(dir, candidate)))) {
      return { kind: "ok", fileName: candidate };
    }
  }
  return { kind: "collision-exhausted" };
};

/** Kept as an alias so pre-9.B call sites (`useArchiveRun.ts`) keep
 * importing a name specific to their use case — same function as
 * {@link resolveFreeName}. Not `@deprecated`, see the note on
 * {@link ResolveArchiveFileNameResult}. */
export const resolveArchiveFileName = resolveFreeName;

export type ArchiveEntryStat = { name: string; size: number; mtime: Date };

export type ScanProcessedForArchiveResult =
  | { kind: "no-processed" }
  | { kind: "empty-processed" }
  | { kind: "scan-error"; rawCode: string }
  | { kind: "aborted" }
  | { kind: "ok"; entries: ArchiveEntryStat[]; totalBytes: number };

/**
 * Lists the regular files directly inside `processedDir` that would go into
 * the archive: `withFileTypes` + `isFile()` (symlinks silently excluded —
 * `Dirent.isFile()` is false for them), filtered through the same
 * `isVisibleNonTmpEntry` predicate `checkProcessedDirConflict` uses (dot-
 * entries and `.tmp` scratch files never included), sorted alphabetically.
 *
 * `no-processed` (ENOENT on the readdir) is distinguished from
 * `empty-processed` (the directory exists but has nothing archivable) so the
 * two constat screens can give different guidance.
 */
export const scanProcessedForArchive = async (
  processedDir: string,
  signal?: AbortSignal,
): Promise<ScanProcessedForArchiveResult> => {
  let dirents;
  try {
    dirents = await readdir(processedDir, { withFileTypes: true });
  } catch (err) {
    const code = extractErrorCode(err);
    if (code === "ENOENT") return { kind: "no-processed" };
    return { kind: "scan-error", rawCode: code };
  }

  const names = dirents
    .filter((d) => d.isFile() && isVisibleNonTmpEntry(d.name))
    .map((d) => d.name)
    .sort();

  if (names.length === 0) return { kind: "empty-processed" };

  const entries: ArchiveEntryStat[] = [];
  let totalBytes = 0;

  for (const name of names) {
    if (signal?.aborted === true) return { kind: "aborted" };
    try {
      const stats = await stat(path.join(processedDir, name));
      entries.push({ name, size: stats.size, mtime: stats.mtime });
      totalBytes += stats.size;
    } catch (err) {
      return { kind: "scan-error", rawCode: extractErrorCode(err) };
    }
  }

  return { kind: "ok", entries, totalBytes };
};
