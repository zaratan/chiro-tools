import { constants as fsConstants, type Dirent } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { describeError } from "../errors/describeError.js";

const WAV_EXTENSION_REGEX = /\.wav$/i;
const BRUT_SUBDIR_REGEX = /^bruts?$/i;

const isAborted = (signal?: AbortSignal): boolean => signal?.aborted === true;

export type DirectoryScanResult =
  | { kind: "not-readable" }
  | { kind: "not-writable" }
  | { kind: "scan-error"; rawCode: string }
  /**
   * The same base filename exists both at the scan root and inside the
   * Brut(s)/ subfolder. Both would produce the same output name in
   * `processed/`, silently overwriting one with the other — refused rather
   * than resolved.
   */
  | { kind: "duplicate-names"; names: string[] }
  | {
      kind: "ok";
      wavFiles: string[];
      ignoredFileCount: number;
      /** Actual on-disk name of the matched subfolder ("Brut", "BRUTS"…), or `null` if none was found. */
      subDirName: string | null;
      /** Count of `wavFiles` entries found directly at the scan root. */
      rootCount: number;
      /** Count of `wavFiles` entries found inside `subDirName`. */
      subCount: number;
    };

type FlatListing = { wavFiles: string[]; ignoredFileCount: number };

/**
 * Lists the `.wav` files in a single already-read directory listing
 * (non-recursive) — case-insensitive extension, hidden files, subdirectories,
 * and symlinks excluded (`Dirent.isFile()` returns false for symlinks).
 * Shared between the scan root and the optional `Brut(s)/` subfolder so both
 * apply the exact same filtering rule.
 */
const listWavFiles = (entries: readonly Dirent[]): FlatListing => {
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

  return { wavFiles, ignoredFileCount };
};

/**
 * Finds a single `Brut`/`Bruts` subfolder, case-insensitive. If several
 * entries match (a pathological setup on a case-sensitive Linux filesystem,
 * e.g. both `Brut/` and `BRUTS/` present at once), the alphabetically first
 * name wins — deterministic rather than dependent on `readdir` order.
 */
const findBrutSubdirName = (entries: readonly Dirent[]): string | null => {
  const matches = entries
    .filter(
      (entry) => entry.isDirectory() && BRUT_SUBDIR_REGEX.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
  return matches[0] ?? null;
};

/**
 * Checks read/write access on `dir`, then lists the `.wav` files directly
 * inside it plus — if present — a single `Brut`/`Bruts` subfolder (any case),
 * one level deep only, never recursive. Results from both locations are
 * merged into one alphabetically sorted list; subfolder entries are prefixed
 * with the subfolder's on-disk name (e.g. `Brut/foo.wav`), so every consumer
 * downstream (rename plan, split queue) can join a returned name straight
 * onto `dir` and address the right file on disk.
 *
 * Refuses (`duplicate-names`) rather than silently picking a winner when the
 * same base filename exists both at the root and in the subfolder.
 *
 * `ignoredFileCount` tallies visible non-wav files across both locations,
 * for screens that report an "other files ignored" count.
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

  let rootEntries;
  try {
    rootEntries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    return { kind: "scan-error", rawCode: describeError(err) };
  }

  const { wavFiles: rootWavFiles, ignoredFileCount: rootIgnored } =
    listWavFiles(rootEntries);

  const subDirName = findBrutSubdirName(rootEntries);

  let subWavFiles: string[] = [];
  let subIgnored = 0;
  if (subDirName !== null) {
    let subEntries: Dirent[];
    try {
      subEntries = await readdir(path.join(dir, subDirName), {
        withFileTypes: true,
      });
    } catch {
      // A subfolder that exists but can't be listed (permissions, race with
      // deletion) contributes nothing rather than degrading the whole scan —
      // per-file errors surface later, at rename/split time.
      subEntries = [];
    }
    const listed = listWavFiles(subEntries);
    subWavFiles = listed.wavFiles.map((name) => path.join(subDirName, name));
    subIgnored = listed.ignoredFileCount;
  }

  const rootBaseNames = new Set(rootWavFiles);
  const duplicateNames = subWavFiles
    .filter((relPath) => rootBaseNames.has(path.basename(relPath)))
    .map((relPath) => path.basename(relPath))
    .sort();
  if (duplicateNames.length > 0) {
    return { kind: "duplicate-names", names: duplicateNames };
  }

  const wavFiles = [...rootWavFiles, ...subWavFiles].sort();

  return {
    kind: "ok",
    wavFiles,
    ignoredFileCount: rootIgnored + subIgnored,
    subDirName,
    rootCount: rootWavFiles.length,
    subCount: subWavFiles.length,
  };
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
