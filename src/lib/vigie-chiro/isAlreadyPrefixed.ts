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
 */
export const isAlreadyPrefixed = (filename: string): boolean => {
  return ALREADY_PREFIXED_REGEX.test(filename);
};
