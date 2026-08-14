import path from "node:path";
import { formatDateStamp } from "./planArchive.js";

export const UPLOAD_DIRNAME = "upload";

/** Relative-path form shown to the user in the TUI (e.g. "./upload/"). */
export const UPLOAD_DIR_DISPLAY = `./${UPLOAD_DIRNAME}/`;

export const buildUploadDir = (cwd: string): string =>
  path.join(cwd, UPLOAD_DIRNAME);

/**
 * Builds the name of the dated series directory a `createZipVolumes` run
 * publishes into `upload/`: `{prefix}_YYYYMMDD`, no extension — it's a
 * directory, not a file. `prefix` defaults to `"depot"` (the honest
 * fallback when `extractCommonPrefix` can't find one unique Vigie-Chiro
 * prefix across the batch — see D2 bis in the phase-9 plan). Same
 * `formatDateStamp` as `buildArchiveName`, so both name builders agree on
 * what "today" looks like.
 */
export const buildSeriesDirName = (
  date: Date,
  prefix: string | null = null,
): string => `${prefix ?? "depot"}_${formatDateStamp(date)}`;

const PART_LABEL = "part";

/**
 * Builds the final on-disk name of volume `index` (1-based) out of `total`
 * volumes in a series named `seriesDirName`. `total === 1` drops the `part`
 * suffix entirely — `depot_20260814.zip`, never
 * `depot_20260814_part1.zip` — a lone volume doesn't need to say "1 of 1".
 * For `total > 1`, the numeric suffix is zero-padded to the width of
 * `total` (`part1`..`part9` for up to 9 volumes, `part01`..`part12` for 10+)
 * so a Finder/lexicographic sort never puts `part10` before `part2`.
 */
export const buildVolumeFileName = (
  seriesDirName: string,
  index: number,
  total: number,
): string => {
  if (total <= 1) return `${seriesDirName}.zip`;
  const width = total.toString().length;
  const padded = index.toString().padStart(width, "0");
  return `${seriesDirName}_${PART_LABEL}${padded}.zip`;
};

const STAGING_SUFFIX = "tmpdir";

/**
 * Builds the hidden staging directory name a `createZipVolumes` run writes
 * volumes into before the single commit rename: `.{seriesDirName}.{pid}
 * .tmpdir`. Suffix is `.tmpdir`, never `.tmp` — `createZipArchive.ts`'s
 * `ORPHAN_TMP_REGEX` (`\.(\d+)\.tmp$`) would otherwise match it and attempt
 * an `unlink()` on a directory, an error its `.catch()` swallows silently,
 * leaving the cleanup permanently inert. The PID lets a liveness check tell
 * a genuinely orphaned staging dir (owning process is dead) from one a
 * concurrent chiro instance is still writing into — see
 * `cleanOrphanStagingDirs` in `createZipVolumes.ts`.
 */
export const buildStagingDirName = (
  seriesDirName: string,
  pid: number,
): string => `.${seriesDirName}.${pid.toString()}.${STAGING_SUFFIX}`;
