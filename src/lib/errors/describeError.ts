import { extractErrorCode } from "../fs/safeFsOps.js";

const NO_CODE_FALLBACK = "sans code";

/**
 * Best-effort human-usable description of a thrown error, for UI fallback
 * paths only (never used to drive control flow — see `extractErrorCode` for
 * that). Prefers the raw `.code` (same vocabulary as the rest of the error
 * mapping); falls back to `.message` when there is no code, which is the
 * common case for a plain rejected `Error`; falls back to a French
 * "sans code" rather than the English "UNKNOWN" label, which would read as
 * unexplained jargon to a non-technical user.
 */
export const describeError = (err: unknown): string => {
  const code = extractErrorCode(err);
  if (code !== "UNKNOWN") return code;
  if (err instanceof Error && err.message.length > 0) return err.message;
  return NO_CODE_FALLBACK;
};
