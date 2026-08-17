import type { SessionEvent } from "../../types.js";
import { CHIRO_VERSION } from "../../version.js";

/**
 * Only what the log actually records. Narrower than the eventual
 * `uploadArchive` runner result on purpose, same reasoning as
 * `ArchiveSessionOutcome` in `buildArchiveSessionEvent.ts`: the runner's
 * result type may carry fields the journal has no business holding (e.g.
 * per-tick progress state), and a caller adapting into this type would
 * otherwise have to invent values for fields nobody reads.
 */
export type OffsiteSessionOutcome =
  | {
      kind: "ok";
      zipName: string;
      zipBytes: number;
      remote: string;
      bucket: string;
      remoteKey: string;
      verified: "size-match" | "unavailable";
      attempts: number;
    }
  | {
      kind: "aborted";
      zipName: string;
      zipBytes: number;
      bytesSent: number;
    }
  | {
      kind: "error";
      code: string;
      zipName: string;
      zipBytes: number;
      bytesSent: number;
    };

/**
 * Builds the v6 (`vigie-upload`) session log entry for a completed offsite
 * archive run, ready to hand to `logSession`.
 *
 * `durationMs` is supplied by the caller rather than read off the outcome —
 * mirrors `buildArchiveSessionEvent`: the orchestrator times the whole
 * attempt itself, since an aborted or errored run has no completion
 * timestamp of its own to derive one from.
 */
export const buildOffsiteSessionEvent = (
  outcome: OffsiteSessionOutcome,
  durationMs: number,
  cwd: string,
): SessionEvent => {
  const base = {
    schema_version: 6 as const,
    ts: new Date().toISOString(),
    version: CHIRO_VERSION,
    cwd,
    action: "vigie-upload" as const,
  };

  if (outcome.kind === "ok") {
    return {
      ...base,
      result: {
        status: "ok",
        zip_name: outcome.zipName,
        zip_bytes: outcome.zipBytes,
        remote: outcome.remote,
        bucket: outcome.bucket,
        remote_key: outcome.remoteKey,
        verified: outcome.verified,
        attempts: outcome.attempts,
        duration_ms: durationMs,
      },
    };
  }

  if (outcome.kind === "aborted") {
    return {
      ...base,
      result: {
        status: "aborted",
        zip_name: outcome.zipName,
        zip_bytes: outcome.zipBytes,
        bytes_sent: outcome.bytesSent,
        duration_ms: durationMs,
      },
    };
  }

  return {
    ...base,
    result: {
      status: "error",
      error_code: outcome.code,
      zip_name: outcome.zipName,
      zip_bytes: outcome.zipBytes,
      bytes_sent: outcome.bytesSent,
      duration_ms: durationMs,
    },
  };
};
