import path from "node:path";
import type { CreateZipVolumesResult } from "../archive/createZipVolumes.js";
import type { SessionEvent } from "../../types.js";
import { CHIRO_VERSION } from "../../version.js";

/**
 * Caps how many per-volume entries `PackageResultSerialized.volumes` carries
 * — a low `CHIRO_MAX_VOLUME_BYTES` used for manual testing can produce 50+
 * volumes, and the JSONL line shouldn't grow unbounded with it.
 * `volume_count` (from `result.volumes.length`, not this cap) stays the true
 * count regardless.
 */
const MAX_LOGGED_VOLUMES = 50;

/**
 * Builds the v4 (`vigie-package`) session log entry for a completed
 * upload-series run, ready to hand to `logSession`.
 *
 * `entryCount`/`totalBytes`/`durationMs` are supplied by the caller rather
 * than read off `result` — mirrors `buildArchiveSessionEvent`: those figures
 * are known before the run even starts (the planned batch), and the
 * "aborted"/"error" variants of `CreateZipVolumesResult` don't carry them at
 * all, so the orchestrator times and counts the whole attempt itself.
 * `maxVolumeBytesUsed` records the actual per-volume cap in effect for this
 * run (normally `maxVolumeBytes()`, but observable in logs if
 * `CHIRO_MAX_VOLUME_BYTES` was set for a manual test).
 */
export const buildPackageSessionEvent = (
  result: CreateZipVolumesResult,
  entryCount: number,
  totalBytes: number,
  durationMs: number,
  cwd: string,
  maxVolumeBytesUsed: number,
): SessionEvent => {
  const base = {
    schema_version: 4 as const,
    ts: new Date().toISOString(),
    version: CHIRO_VERSION,
    cwd,
    action: "vigie-package" as const,
  };

  if (result.kind === "ok") {
    return {
      ...base,
      result: {
        status: "ok",
        series_dir: path.basename(result.seriesDirPath),
        volume_count: result.volumes.length,
        volumes: result.volumes.slice(0, MAX_LOGGED_VOLUMES).map((v) => ({
          name: v.fileName,
          entry_count: v.entryCount,
          zip_bytes: v.zipBytes,
        })),
        max_volume_bytes: maxVolumeBytesUsed,
        entry_count: entryCount,
        total_bytes: totalBytes,
        duration_ms: durationMs,
        durable: result.durable,
      },
    };
  }

  if (result.kind === "aborted") {
    return {
      ...base,
      result: {
        status: "aborted",
        max_volume_bytes: maxVolumeBytesUsed,
        entry_count: entryCount,
        total_bytes: totalBytes,
        duration_ms: durationMs,
      },
    };
  }

  return {
    ...base,
    result: {
      status: "error",
      error_code: result.code,
      max_volume_bytes: maxVolumeBytesUsed,
      entry_count: entryCount,
      total_bytes: totalBytes,
      duration_ms: durationMs,
    },
  };
};
