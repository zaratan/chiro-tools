/**
 * Deliberately broader than `isAlreadyPrefixed.ts`'s `ALREADY_PREFIXED_REGEX`
 * (`[A-Za-z]\d-`, which assumes exactly one letter and one digit): real
 * point codes vary in length (`A1`, `Z9`, `ETANG`...), so this one captures
 * `[A-Z0-9]+` instead. It also returns the matched prefix rather than a
 * boolean — used for archive/folder naming, not for idempotence checks. Do
 * not reuse or modify `isAlreadyPrefixed.ts`: different purpose, different
 * regex, both correct for their own job.
 */
const PREFIX_REGEX = /^(Car\d{6}-\d{4}-Pass\d+-[A-Z0-9]+)-/;

/**
 * Extracts the Vigie-Chiro prefix (`Car{6 digits}-{year}-Pass{N}-{point}`)
 * shared by every name in `names`, or `null` if the list is empty, any name
 * doesn't match the pattern, or the matched prefixes disagree.
 */
export const extractCommonPrefix = (
  names: readonly string[],
): string | null => {
  if (names.length === 0) return null;

  let commonPrefix: string | null = null;
  for (const name of names) {
    const match = PREFIX_REGEX.exec(name);
    if (match === null) return null;
    const prefix = match[1];
    if (prefix === undefined) return null;
    if (commonPrefix === null) commonPrefix = prefix;
    else if (commonPrefix !== prefix) return null;
  }
  return commonPrefix;
};
