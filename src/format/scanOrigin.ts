export type ScanOriginNote =
  | { kind: "all-sub"; label: string }
  | { kind: "mixed"; label: string; rootCount: number; subCount: number };

/**
 * Derives the "where did these recordings come from" note for a Constat
 * screen, from `scanDirectory`'s per-location counts.
 *
 * Returns `null` when everything comes from the scan root — the calling
 * screen must then read exactly as it did before the `Brut/` subfolder
 * feature existed, so callers should treat `null` as "render nothing extra".
 */
export const describeScanOrigin = (
  subDirName: string | null,
  rootCount: number,
  subCount: number,
): ScanOriginNote | null => {
  if (subDirName === null || subCount === 0) return null;
  const label = `./${subDirName}/`;
  if (rootCount === 0) return { kind: "all-sub", label };
  return { kind: "mixed", label, rootCount, subCount };
};
