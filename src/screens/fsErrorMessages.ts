/**
 * Shared mapping for the small set of raw filesystem error codes that mean
 * the same thing across every flow: verbatim wording from
 * `vigie-process/errorMessages.ts`, the first flow to need them. The
 * `vigie-archive` flow crossing the Rule-of-Three threshold (a 3rd
 * consumer of the exact same codes) is why this got extracted here rather
 * than duplicated a 3rd time.
 *
 * Returns `null` for anything outside this narrow common set — callers layer
 * their own flow-specific codes (mkdir:, sox-, verify-failed, etc.) on top,
 * the same way `mapKnownProcessErrorCode` and `mapKnownErrorCode` already
 * do for their own union types.
 */
export const mapKnownFsErrorCode = (code: string): string | null => {
  switch (code) {
    case "EACCES":
    case "EPERM":
      return "permission refusée par le système";
    case "ENOSPC":
      return "plus de place sur le disque — libérez de l'espace puis relancez";
    case "EROFS":
      return "ce disque est protégé en écriture — copiez les fichiers ailleurs puis relancez";
    default:
      return null;
  }
};
