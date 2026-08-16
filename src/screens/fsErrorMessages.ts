/**
 * Shared mapping for the small set of raw filesystem error codes that mean
 * the same thing across every flow: verbatim wording from
 * `vigie-process/errorMessages.ts`, the first flow to need them. Four flows
 * consume the same codes; one wording, one place.
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
