import { MAX_UINT32 } from "./zipFormat.js";

const ENV_VAR = "CHIRO_MAX_VOLUME_BYTES";

export const DEFAULT_MAX_VOLUME_BYTES = 3.5 * 1024 ** 3;

const MIN_VOLUME_BYTES = 1024 * 1024; // 1 MiB
const SAFETY_MARGIN_BYTES = 64 * 1024 * 1024; // 64 MiB
const MAX_VOLUME_BYTES_CEILING = MAX_UINT32 - SAFETY_MARGIN_BYTES;

/**
 * The per-zip byte cap used by the volume-splitting orchestrator (9.B),
 * defaulting to 3.5 GiB — comfortably under the Vigie-Chiro upload portal's
 * rejection of ZIP64. Overridable via `CHIRO_MAX_VOLUME_BYTES` for manual
 * testing with small fixtures, but clamped to `[1 MiB, MAX_UINT32 - 64 MiB]`
 * so a stray `export CHIRO_MAX_VOLUME_BYTES=...` left in a shell profile
 * after a manual test session can never push a real run into ZIP64
 * territory (`zip64: "forbid"` becomes reachable exactly when a volume
 * would cross the classic offset/size limits — the 64 MiB margin keeps the
 * cap safely below that boundary even accounting for central-directory
 * overhead).
 */
export const maxVolumeBytes = (): number => {
  const raw = process.env[ENV_VAR];
  const parsed = raw === undefined ? NaN : Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_MAX_VOLUME_BYTES;
  }
  return Math.min(Math.max(parsed, MIN_VOLUME_BYTES), MAX_VOLUME_BYTES_CEILING);
};
