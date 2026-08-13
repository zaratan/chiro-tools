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
 * Builds the archive file name from a (local-time) date:
 * `processed_YYYYMMDDHHMM.zip`. Pure — the caller supplies `date` so the
 * "now" moment is a single decision made once by the orchestrator, not
 * re-read here.
 */
export const buildArchiveName = (date: Date): string => {
  const y = date.getFullYear().toString();
  const mo = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const h = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  return `processed_${y}${mo}${d}${h}${mi}.zip`;
};

const MAX_COLLISION_SUFFIX = 99;
const FIRST_COLLISION_SUFFIX = 2;

export type ResolveArchiveFileNameResult =
  { kind: "ok"; fileName: string } | { kind: "collision-exhausted" };

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Resolves a non-colliding file name inside `archivedDir` for `baseName`
 * (e.g. `processed_202608121430.zip`): the base name itself if free,
 * otherwise `-2` through `-99` suffixes inserted before the extension. The
 * suffix range is generous — `collision-exhausted` exists for no-throw
 * exhaustiveness, not because it's expected to be reached (it would require
 * 99 archives created in the same clock minute).
 */
export const resolveArchiveFileName = async (
  archivedDir: string,
  baseName: string,
): Promise<ResolveArchiveFileNameResult> => {
  if (!(await pathExists(path.join(archivedDir, baseName)))) {
    return { kind: "ok", fileName: baseName };
  }

  const ext = path.extname(baseName);
  const stem = baseName.slice(0, baseName.length - ext.length);

  for (
    let suffix = FIRST_COLLISION_SUFFIX;
    suffix <= MAX_COLLISION_SUFFIX;
    suffix++
  ) {
    const candidate = `${stem}-${suffix.toString()}${ext}`;
    if (!(await pathExists(path.join(archivedDir, candidate)))) {
      return { kind: "ok", fileName: candidate };
    }
  }

  return { kind: "collision-exhausted" };
};

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
