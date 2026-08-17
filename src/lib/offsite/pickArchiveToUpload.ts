import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { ARCHIVE_ZIP_NAME_REGEX } from "../archive/planArchive.js";
import { extractErrorCode } from "../fs/safeFsOps.js";
import { isVisibleNonTmpEntry } from "../fs/scanDirectory.js";

export type ChosenArchive = {
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
};

export type PickArchiveResult =
  | { kind: "ok"; chosen: ChosenArchive; otherCount: number }
  | { kind: "none" }
  | { kind: "aborted" }
  | { kind: "error"; code: string };

const isAborted = (signal?: AbortSignal): boolean => signal?.aborted === true;

/**
 * Picks the backup zip to archive offsite: `archived/` accumulates over
 * time (re-splits, same-day collisions all land there), so this is not "the
 * one file in the folder" but "the most recent one by mtime". Ties (same
 * mtime, e.g. two zips written in the same second) break on name descending
 * so the choice is deterministic across runs — an mtime-only sort is stable
 * per Node's spec, but two equal keys landing in readdir order would make
 * the pick depend on filesystem enumeration order, which is not guaranteed.
 */
export const pickArchiveToUpload = async (
  archivedDir: string,
  signal?: AbortSignal,
): Promise<PickArchiveResult> => {
  let dirents;
  try {
    dirents = await readdir(archivedDir, { withFileTypes: true });
  } catch (err) {
    const code = extractErrorCode(err);
    if (code === "ENOENT") return { kind: "none" };
    return { kind: "error", code };
  }

  const candidateNames = dirents
    .filter(
      (d) =>
        d.isFile() &&
        isVisibleNonTmpEntry(d.name) &&
        ARCHIVE_ZIP_NAME_REGEX.test(d.name),
    )
    .map((d) => d.name);

  if (candidateNames.length === 0) return { kind: "none" };

  const candidates: ChosenArchive[] = [];
  for (const name of candidateNames) {
    if (isAborted(signal)) return { kind: "aborted" };
    try {
      const stats = await stat(path.join(archivedDir, name));
      candidates.push({
        name,
        path: path.join(archivedDir, name),
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      });
    } catch (err) {
      return { kind: "error", code: extractErrorCode(err) };
    }
  }

  candidates.sort((a, b) => {
    if (b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
    return b.name.localeCompare(a.name);
  });

  const chosen = candidates[0];
  if (chosen === undefined) return { kind: "none" };

  return { kind: "ok", chosen, otherCount: candidates.length - 1 };
};
