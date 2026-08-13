import { constants as fsConstants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { describeError } from "../errors/describeError.js";

const WAV_EXTENSION_REGEX = /\.wav$/i;

const isAborted = (signal?: AbortSignal): boolean => signal?.aborted === true;

export type DirectoryScanResult =
  | { kind: "not-readable" }
  | { kind: "not-writable" }
  | { kind: "scan-error"; rawCode: string }
  | { kind: "ok"; wavFiles: string[]; ignoredFileCount: number };

/**
 * Checks read/write access on `dir`, then lists the `.wav` files directly
 * inside it — case-insensitive extension, hidden files, subdirectories, and
 * symlinks excluded (`Dirent.isFile()` returns false for symlinks) — sorted
 * alphabetically.
 *
 * `ignoredFileCount` tallies visible non-wav files, for screens that report
 * an "other files ignored" count.
 */
export const scanDirectory = async (
  dir: string,
): Promise<DirectoryScanResult> => {
  try {
    await access(dir, fsConstants.R_OK);
  } catch {
    return { kind: "not-readable" };
  }
  try {
    await access(dir, fsConstants.W_OK);
  } catch {
    return { kind: "not-writable" };
  }

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    return { kind: "scan-error", rawCode: describeError(err) };
  }

  const wavFiles: string[] = [];
  let ignoredFileCount = 0;

  for (const dirent of entries) {
    if (!dirent.isFile()) continue;
    if (dirent.name.startsWith(".")) continue;
    if (WAV_EXTENSION_REGEX.test(dirent.name)) {
      wavFiles.push(dirent.name);
    } else {
      ignoredFileCount += 1;
    }
  }

  wavFiles.sort();

  return { kind: "ok", wavFiles, ignoredFileCount };
};

export type SumFileSizesResult =
  { kind: "ok"; totalBytes: number } | { kind: "aborted" };

/**
 * Sums the on-disk size of `files` (relative to `dir`). Best-effort: a file
 * that fails to `stat` (e.g. deleted between scan and tally) is skipped
 * rather than aborting the whole tally — mirrors `estimateChunkCount`.
 *
 * Returns a tagged result rather than a bare number: an aborted tally would
 * otherwise be indistinguishable from a genuinely complete (possibly zero)
 * sum, silently passing the caller's disk-space pre-check on a partial total.
 */
export const sumFileSizes = async (
  dir: string,
  files: readonly string[],
  signal?: AbortSignal,
): Promise<SumFileSizesResult> => {
  let totalBytes = 0;
  for (const name of files) {
    if (isAborted(signal)) return { kind: "aborted" };
    try {
      const stats = await stat(path.join(dir, name));
      totalBytes += stats.size;
    } catch {
      // Ignore individual file stat failures — best effort.
    }
  }
  return { kind: "ok", totalBytes };
};

export type ProcessedDirState = { exists: boolean; nonTmpCount: number };

/**
 * Shared predicate for "counts as real content" across scans of an output
 * directory: excludes dot-entries (both the sox fast-path's hidden
 * `.sox-tmp-*` scratch dirs, which can survive a SIGKILL mid-batch, and
 * system litter like `.DS_Store`) and `.tmp` scratch files. Exported so
 * every consumer (conflict detection, archive scan) applies the exact same
 * rule — divergence here would be structurally impossible to catch in review.
 */
export const isVisibleNonTmpEntry = (name: string): boolean =>
  !name.endsWith(".tmp") && !name.startsWith(".");

/**
 * Checks whether `processedDir` already exists and, if so, how many
 * non-`.tmp` entries it holds — used to detect a leftover output folder from
 * a previous run before starting a new one.
 *
 * Dot-entries are excluded from the count alongside `.tmp` ones — see
 * `isVisibleNonTmpEntry`. Without this, a leftover `.sox-tmp-*` alone would
 * trip the "processed already exists" screen on a folder that looks empty in
 * the Finder — an unexplainable state for the target user.
 */
export const checkProcessedDirConflict = async (
  processedDir: string,
): Promise<ProcessedDirState> => {
  try {
    const entries = await readdir(processedDir);
    const nonTmpCount = entries.filter(isVisibleNonTmpEntry).length;
    return { exists: true, nonTmpCount };
  } catch {
    return { exists: false, nonTmpCount: 0 };
  }
};
