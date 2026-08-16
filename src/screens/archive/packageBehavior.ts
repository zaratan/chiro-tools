import { readdir } from "node:fs/promises";
import type {
  createZipVolumes as defaultCreateZipVolumes,
  CreateZipVolumesResult,
} from "../../lib/archive/createZipVolumes.js";
import { maxVolumeBytes } from "../../lib/archive/maxVolumeBytes.js";
import type { ArchiveEntryStat } from "../../lib/archive/planArchive.js";
import { buildSeriesDirName } from "../../lib/archive/planUpload.js";
import { buildPackageSessionEvent } from "../../lib/logging/buildPackageSessionEvent.js";
import { extractCommonPrefix } from "../../lib/vigie-chiro/extractCommonPrefix.js";
import type {
  ArchiveRunner,
  BuildRunSessionEvent,
  PackageOkResult,
  ResolveTargetName,
} from "./useArchiveRun.js";

export type CreateZipVolumesFn = typeof defaultCreateZipVolumes;

const UPLOAD_SERIES_NAME_REGEX =
  /^(?:depot|Car\d{6}-\d{4}-Pass\d+-[A-Z0-9]+)_\d{8}(-\d+)?$/;

/**
 * Whether `uploadDir` already holds a series directory from a previous run
 * — drives the upload Confirmation screen's "un dossier de dépôt existe
 * déjà" reassurance line. Mirrors `hasExistingArchiveZip` in
 * `backupBehavior.ts`: a directory-name check, not a collision check for
 * *this run's* exact name (that's resolved at commit time inside
 * `createZipVolumes`, never here).
 */
export const hasExistingUploadSeries = async (
  uploadDir: string,
): Promise<boolean> => {
  try {
    const dirEntries = await readdir(uploadDir);
    return dirEntries.some((name) => UPLOAD_SERIES_NAME_REGEX.test(name));
  } catch {
    return false;
  }
};

export type PackageBehavior = {
  resolveTargetName: ResolveTargetName;
  runner: ArchiveRunner<PackageOkResult>;
  buildSessionEvent: BuildRunSessionEvent<PackageOkResult>;
};

/**
 * Builds the `useArchiveRun` triplet for the multi-volume Vigie-Chiro
 * upload-series flow: one `createZipVolumes` call, `zip64: "forbid"` enforced inside it, not here. Unlike the
 * backup flow, the preview name shown here is never collision-resolved: the
 * commit-time rename loop inside `createZipVolumes` is the single place
 * that decides on a `-2` suffix (D2), so showing anything else at preview
 * time would just be a guess that could turn out wrong.
 */
export const createPackageBehavior = (
  processedDir: string,
  uploadDir: string,
  entries: readonly ArchiveEntryStat[],
  createZipVolumes: CreateZipVolumesFn,
): PackageBehavior => {
  const prefix = extractCommonPrefix(entries.map((e) => e.name));

  const resolveTargetName: ResolveTargetName = async () => {
    const name = buildSeriesDirName(new Date(), prefix);
    const alreadyExists = await hasExistingUploadSeries(uploadDir);
    return { name, alreadyExists };
  };

  const runner: ArchiveRunner<PackageOkResult> = async ({
    entries: runEntries,
    signal,
    onProgress,
  }) => {
    // Fresh seriesDirName from `new Date()`, not the preview's — mirrors
    // the backup flow's re-resolve, though here the value only matters for
    // volume file naming: the actual commit name is decided later.
    const seriesDirName = buildSeriesDirName(new Date(), prefix);
    const result = await createZipVolumes({
      sourceDir: processedDir,
      entries: runEntries,
      uploadDir,
      seriesDirName,
      signal,
      onProgress,
    });
    if (result.kind === "ok") {
      return {
        kind: "package-ok",
        seriesDirPath: result.seriesDirPath,
        seriesDirName: result.seriesDirName,
        volumes: result.volumes,
        entryCount: result.entryCount,
        totalZipBytes: result.totalZipBytes,
        durationMs: result.durationMs,
        durable: result.durable,
      };
    }
    return result;
  };

  const buildSessionEvent: BuildRunSessionEvent<PackageOkResult> = (
    result,
    entryCount,
    totalBytes,
    durationMs,
    cwd,
  ) => {
    let adapted: CreateZipVolumesResult;
    switch (result.kind) {
      case "package-ok":
        adapted = {
          kind: "ok",
          seriesDirPath: result.seriesDirPath,
          seriesDirName: result.seriesDirName,
          volumes: result.volumes,
          entryCount: result.entryCount,
          totalZipBytes: result.totalZipBytes,
          durationMs: result.durationMs,
          durable: result.durable,
        };
        break;
      case "aborted":
        adapted = { kind: "aborted" };
        break;
      case "error":
        adapted = { kind: "error", code: result.code };
        break;
    }
    return buildPackageSessionEvent(
      adapted,
      entryCount,
      totalBytes,
      durationMs,
      cwd,
      maxVolumeBytes(),
    );
  };

  return { resolveTargetName, runner, buildSessionEvent };
};
