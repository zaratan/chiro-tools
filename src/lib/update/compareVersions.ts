import type { ParsedVersion } from "./parseVersion.js";

type Ordering = -1 | 0 | 1;

const sign = (n: number): -1 | 1 => (n < 0 ? -1 : 1);

const isNumericIdentifier = (id: string): boolean => /^\d+$/.test(id);

/**
 * Compares two pre-release identifier arrays per semver §11.4:
 * - Numeric identifiers have lower precedence than alphanumeric ones.
 * - Numeric identifiers are compared numerically.
 * - Alphanumeric identifiers are compared lexicographically (ASCII).
 * - A larger set of pre-release fields has higher precedence when all
 *   preceding identifiers are equal.
 */
const comparePrerelease = (a: string[], b: string[]): Ordering => {
  const len = Math.max(a.length, b.length);

  for (let i = 0; i < len; i++) {
    const idA = a[i];
    const idB = b[i];

    // One list is exhausted → the shorter one has lower precedence
    if (idA === undefined) return -1;
    if (idB === undefined) return 1;

    const aIsNum = isNumericIdentifier(idA);
    const bIsNum = isNumericIdentifier(idB);

    if (aIsNum && bIsNum) {
      const diff = parseInt(idA, 10) - parseInt(idB, 10);
      if (diff !== 0) return sign(diff);
      continue;
    }

    // §11.4.3: non-numeric > numeric
    if (aIsNum && !bIsNum) return -1;
    if (!aIsNum && bIsNum) return 1;

    // Both non-numeric: lexicographic ASCII comparison
    if (idA < idB) return -1;
    if (idA > idB) return 1;
  }

  return 0;
};

/**
 * Compares two parsed versions according to semver 2.0 precedence rules.
 *
 * Returns -1 if a < b, 0 if a === b, 1 if a > b.
 * Build metadata is already discarded by parseVersion and has no effect here.
 */
export const compareVersions = (
  a: ParsedVersion,
  b: ParsedVersion,
): Ordering => {
  const majorDiff = a.major - b.major;
  if (majorDiff !== 0) return sign(majorDiff);

  const minorDiff = a.minor - b.minor;
  if (minorDiff !== 0) return sign(minorDiff);

  const patchDiff = a.patch - b.patch;
  if (patchDiff !== 0) return sign(patchDiff);

  // §11.3: release > pre-release when M.m.p are equal
  if (a.prerelease === null && b.prerelease === null) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;

  return comparePrerelease(a.prerelease, b.prerelease);
};
