export type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  /** null for stable releases; array of dot-split identifiers for pre-releases */
  prerelease: string[] | null;
};

const VERSION_REGEX = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?(?:\+[\w.-]+)?$/;

const hasLeadingZero = (raw: string): boolean => /^0\d/.test(raw);

const parsePrerelease = (raw: string | undefined): string[] | null | false => {
  if (raw === undefined) return null;

  const parts = raw.split(".");
  // Reject empty parts (e.g. "rc..1" or trailing dot)
  if (parts.some((p) => p === "")) return false;

  return parts;
};

/**
 * Parses a semver string into its components, or returns null if invalid.
 *
 * Conforms to semver 2.0: accepts optional `v` prefix, discards build
 * metadata, rejects leading zeros on numeric components and empty
 * pre-release identifiers.
 */
export const parseVersion = (input: string): ParsedVersion | null => {
  const match = VERSION_REGEX.exec(input);
  if (!match) return null;

  // Groups 1-3 are required capturing groups and are always present after a
  // successful match. We destructure as a typed tuple to satisfy
  // noUncheckedIndexedAccess without adding unreachable runtime guards.
  const [, majorRaw, minorRaw, patchRaw, prereleaseRaw] = match as unknown as [
    string,
    string,
    string,
    string,
    string | undefined,
  ];

  if (
    hasLeadingZero(majorRaw) ||
    hasLeadingZero(minorRaw) ||
    hasLeadingZero(patchRaw)
  ) {
    return null;
  }

  const prerelease = parsePrerelease(prereleaseRaw);
  // parsePrerelease returns false to signal a parse error (empty parts)
  if (prerelease === false) return null;

  return {
    major: parseInt(majorRaw, 10),
    minor: parseInt(minorRaw, 10),
    patch: parseInt(patchRaw, 10),
    prerelease,
  };
};
