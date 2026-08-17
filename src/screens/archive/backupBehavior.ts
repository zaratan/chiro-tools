import { readdir } from "node:fs/promises";
import path from "node:path";
import type { createZipArchive as defaultCreateZipArchive } from "../../lib/archive/createZipArchive.js";
import {
  ARCHIVE_ZIP_NAME_REGEX,
  buildArchiveName,
  resolveArchiveFileName,
  type ArchiveEntryStat,
} from "../../lib/archive/planArchive.js";
import {
  buildArchiveSessionEvent,
  type ArchiveSessionOutcome,
} from "../../lib/logging/buildArchiveSessionEvent.js";
import { extractCommonPrefix } from "../../lib/vigie-chiro/extractCommonPrefix.js";
import type {
  ArchiveRunner,
  BackupOkResult,
  BuildRunSessionEvent,
  ResolveTargetName,
} from "./useArchiveRun.js";

export type CreateZipArchiveFn = typeof defaultCreateZipArchive;

/**
 * Whether `archivedDir` already holds a zip from a previous run — drives the
 * Confirmation screen's "un zip existe déjà" reassurance line. Distinct from
 * `resolveArchiveFileName`'s collision check: that one only tells us whether
 * *this run's exact date-stamped name* collides, not whether the folder has
 * older zips in it.
 */
export const hasExistingArchiveZip = async (
  archivedDir: string,
): Promise<boolean> => {
  try {
    const dirEntries = await readdir(archivedDir);
    return dirEntries.some((name) => ARCHIVE_ZIP_NAME_REGEX.test(name));
  } catch {
    return false;
  }
};

export type BackupBehavior = {
  resolveTargetName: ResolveTargetName;
  runner: ArchiveRunner<BackupOkResult>;
  buildSessionEvent: BuildRunSessionEvent<BackupOkResult>;
};

/**
 * Builds the `useArchiveRun` triplet for the single-zip backup flow: one
 * `createZipArchive` call, ZIP64 left nominal (the plan's D4 explicitly
 * excludes this flow from the "forbid" guard — it isn't going to the
 * Vigie-Chiro portal). `entries` is captured here (constant for the
 * lifetime of a Confirmation screen instance) so the closures below don't
 * need it passed in again at call time beyond what `ArchiveRunner` already
 * provides.
 */
export const createBackupBehavior = (
  processedDir: string,
  archivedDir: string,
  entries: readonly ArchiveEntryStat[],
  createZipArchive: CreateZipArchiveFn,
): BackupBehavior => {
  const prefix = extractCommonPrefix(entries.map((e) => e.name));

  const resolveTargetName: ResolveTargetName = async () => {
    const baseName = buildArchiveName(new Date(), prefix);
    const [resolved, alreadyExists] = await Promise.all([
      resolveArchiveFileName(archivedDir, baseName),
      hasExistingArchiveZip(archivedDir),
    ]);
    return {
      name: resolved.kind === "ok" ? resolved.fileName : baseName,
      alreadyExists,
    };
  };

  const runner: ArchiveRunner<BackupOkResult> = async ({
    entries: runEntries,
    signal,
    onProgress,
  }) => {
    // Fresh baseName from `new Date()`, not the preview's — narrows the
    // collision window between the preview render and Entrée.
    const baseName = buildArchiveName(new Date(), prefix);
    const resolved = await resolveArchiveFileName(archivedDir, baseName);
    if (resolved.kind !== "ok") {
      return { kind: "error", code: "collision-exhausted" };
    }
    const zipPath = path.join(archivedDir, resolved.fileName);
    const result = await createZipArchive({
      sourceDir: processedDir,
      entries: runEntries,
      zipPath,
      signal,
      onProgress,
    });
    if (result.kind === "ok") {
      return {
        kind: "backup-ok",
        zipPath: result.zipPath,
        zipBytes: result.zipBytes,
        entryCount: result.entryCount,
        durationMs: result.durationMs,
        durable: result.durable,
      };
    }
    return result;
  };

  const buildSessionEvent: BuildRunSessionEvent<BackupOkResult> = (
    result,
    entryCount,
    totalBytes,
    durationMs,
    runCwd,
  ) => {
    let adapted: ArchiveSessionOutcome;
    switch (result.kind) {
      case "backup-ok":
        adapted = {
          kind: "ok",
          zipPath: result.zipPath,
          zipBytes: result.zipBytes,
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
    return buildArchiveSessionEvent(
      adapted,
      entryCount,
      totalBytes,
      durationMs,
      runCwd,
    );
  };

  return { resolveTargetName, runner, buildSessionEvent };
};
