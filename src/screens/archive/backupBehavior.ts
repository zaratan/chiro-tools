import { readdir } from "node:fs/promises";
import path from "node:path";
import type {
  createZipArchive as defaultCreateZipArchive,
  CreateZipArchiveResult,
} from "../../lib/archive/createZipArchive.js";
import {
  buildArchiveName,
  resolveArchiveFileName,
  type ArchiveEntryStat,
} from "../../lib/archive/planArchive.js";
import { buildArchiveSessionEvent } from "../../lib/logging/buildArchiveSessionEvent.js";
import { extractCommonPrefix } from "../../lib/vigie-chiro/extractCommonPrefix.js";
import type {
  ArchiveRunner,
  BuildRunSessionEvent,
  ResolveTargetName,
} from "./useArchiveRun.js";

export type CreateZipArchiveFn = typeof defaultCreateZipArchive;

const ARCHIVE_ZIP_NAME_REGEX =
  /^(?:processed|Car\d{6}-\d{4}-Pass\d+-[A-Z0-9]+)_\d{8}(?:\d{4})?(-\d+)?\.zip$/;

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
  runner: ArchiveRunner;
  buildSessionEvent: BuildRunSessionEvent;
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

  const runner: ArchiveRunner = async ({
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
      };
    }
    return result;
  };

  const buildSessionEvent: BuildRunSessionEvent = (
    result,
    entryCount,
    totalBytes,
    durationMs,
    runCwd,
  ) => {
    let adapted: CreateZipArchiveResult;
    switch (result.kind) {
      case "backup-ok":
        adapted = {
          kind: "ok",
          zipPath: result.zipPath,
          zipBytes: result.zipBytes,
          entryCount: result.entryCount,
          durationMs: result.durationMs,
        };
        break;
      case "aborted":
        adapted = { kind: "aborted" };
        break;
      case "error":
        adapted = { kind: "error", code: result.code };
        break;
      case "package-ok":
        // Cannot happen in practice: this closure's own `runner` (above)
        // only ever produces backup-ok/aborted/error — `BuildRunSessionEvent`
        // is only this wide because its type is shared with the package
        // flow (`useArchiveRun.ts`). Logged defensively rather than thrown,
        // consistent with the project's no-throw-on-normal-paths rule.
        adapted = { kind: "error", code: "wrong-behavior-wired:package-ok" };
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
