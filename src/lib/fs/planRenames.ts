import { access } from "node:fs/promises";
import path from "node:path";
import type { RenamePlan } from "../../types.js";
import { isAlreadyPrefixed } from "../vigie-chiro/isAlreadyPrefixed.js";

/**
 * Derives the target filename for a given source name and prefix.
 *
 * The extension is always normalized to lowercase `.wav`,
 * even if the source had `.WAV`.
 */
const buildTargetName = (filename: string, prefix: string): string => {
  const lastDotIndex = filename.lastIndexOf(".");
  const baseName =
    lastDotIndex === -1 ? filename : filename.slice(0, lastDotIndex);
  return `${prefix}${baseName}.wav`;
};

/**
 * Checks whether a file exists on disk.
 *
 * @returns `true` if the file exists, `false` otherwise (ENOENT).
 */
const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Builds the complete rename plan for a list of WAV filenames.
 *
 * For each file:
 * - If `isAlreadyPrefixed(file)` → skipped (already-prefixed bucket)
 * - Otherwise, compute the target name = prefix + basename-without-ext + ".wav" (lowercase ext)
 * - If the target already exists on disk → skipped (collision bucket)
 * - If two source files would produce the SAME target (intra-plan collision, e.g. APFS case-insensitive) → keep the first one in operations, push the rest to the collision bucket
 *
 * Operations are sorted alphabetically by `from`.
 *
 * @param files Plain filenames (NOT absolute paths). Typically the output of `scanWavFiles`.
 * @param prefix The Vigie-Chiro prefix (e.g. "Car040962-2026-Pass3-A1-"), output of `buildPrefix`.
 * @param dir Absolute directory path — used to check on-disk collisions via `fs.access`.
 */
export const planRenames = async (
  files: string[],
  prefix: string,
  dir: string,
): Promise<RenamePlan> => {
  const plan: RenamePlan = {
    operations: [],
    skippedAlreadyPrefixed: [],
    skippedCollision: [],
  };

  // Work on a sorted copy so that intra-plan collision detection is stable:
  // when two sources map to the same target, the alphabetically first one wins.
  const sortedFiles = [...files].sort();

  // Track targets already claimed by an earlier operation in this plan.
  const claimedTargets = new Set<string>();

  for (const filename of sortedFiles) {
    if (isAlreadyPrefixed(filename)) {
      plan.skippedAlreadyPrefixed.push(filename);
      continue;
    }

    const targetName = buildTargetName(filename, prefix);

    // Intra-plan collision: another source already claims this target.
    if (claimedTargets.has(targetName)) {
      plan.skippedCollision.push(filename);
      continue;
    }

    // External collision: the target already exists on disk.
    const targetExists = await fileExists(path.join(dir, targetName));
    if (targetExists) {
      plan.skippedCollision.push(filename);
      continue;
    }

    claimedTargets.add(targetName);
    plan.operations.push({ from: filename, to: targetName });
  }

  return plan;
};
