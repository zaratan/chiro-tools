import path from "node:path";
/**
 * Only what the log actually records. Narrower than `CreateZipArchiveResult`
 * on purpose: that type also carries `archivedNames`, a per-run manifest the
 * journal has no business holding, and callers adapting into it would have to
 * invent a value for a field nobody reads.
 */
export type ArchiveSessionOutcome =
  | { kind: "ok"; zipPath: string; zipBytes: number; durable: boolean }
  | { kind: "aborted" }
  | { kind: "error"; code: string };
import type { SessionEvent } from "../../types.js";
import { CHIRO_VERSION } from "../../version.js";

/**
 * Builds the v5 (`vigie-archive`) session log entry for a completed zip
 * creation run, ready to hand to `logSession`.
 *
 * `durationMs` is supplied by the caller (`useArchiveRun`) rather than read
 * off `result.durationMs` — that field only exists on the "ok" variant of
 * `CreateZipArchiveResult`, but the log needs a duration for aborted and
 * errored runs too, so the orchestrator times the whole attempt itself.
 */
export const buildArchiveSessionEvent = (
  result: ArchiveSessionOutcome,
  entryCount: number,
  totalBytes: number,
  durationMs: number,
  cwd: string,
): SessionEvent => {
  const base = {
    schema_version: 5 as const,
    ts: new Date().toISOString(),
    version: CHIRO_VERSION,
    cwd,
    action: "vigie-archive" as const,
  };

  if (result.kind === "ok") {
    return {
      ...base,
      result: {
        status: "ok",
        zip_name: path.basename(result.zipPath),
        entry_count: entryCount,
        total_bytes: totalBytes,
        zip_bytes: result.zipBytes,
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
      entry_count: entryCount,
      total_bytes: totalBytes,
      duration_ms: durationMs,
    },
  };
};
