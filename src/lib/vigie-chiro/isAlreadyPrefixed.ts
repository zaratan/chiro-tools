import path from "node:path";

/**
 * Idempotence regex: matches filenames already prefixed by chiro.
 *
 * Format: `Car{6 digits}-{4 digits}-Pass{N+}-{letter}{digit}-`
 */
const ALREADY_PREFIXED_REGEX = /^Car\d{6}-\d{4}-Pass\d+-[A-Za-z]\d-/;

/**
 * Tells whether a filename is already in the Vigie-Chiro prefixed format.
 *
 * A prefixed file is skipped during rename (idempotence guarantee).
 * Matching is case-sensitive: uppercase `Car` is required.
 *
 * `filename` may be a plain name or a path relative to the scan root (e.g.
 * `Brut/Car040962-2026-Pass3-A1-old.wav`, from a `Brut/` subfolder scan) —
 * only the basename is tested, so the prefix is recognized regardless of
 * which directory it lives in.
 */
export const isAlreadyPrefixed = (filename: string): boolean => {
  return ALREADY_PREFIXED_REGEX.test(path.basename(filename));
};
