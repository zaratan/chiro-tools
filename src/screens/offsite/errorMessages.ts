/**
 * Maps a `remoteStat`/`uploadArchive` outcome code to a French message.
 * Mirrors `screens/archive/errorMessages.ts`, with one difference: messages
 * here are already capitalized and punctuated (the constat screen — 10.B1 —
 * renders them as-is, with no `asSentence` wrapper), so every new case added
 * for the run (10.B2) follows that same convention rather than archive's
 * lowercase-plus-wrapper one. "chiro" itself still never gets capitalized,
 * sentence-initial or not (docs/ux.md brand rule).
 *
 * Codes covered:
 * - `bucket-missing` / `config-error` — from `remoteStat`, at the constat.
 * - `rclone-spawn-failed` — from either `remoteStat` or `uploadArchive`:
 *   chiro itself couldn't launch the rclone process, never a network or
 *   remote-content question.
 * - `verify-failed` / `verify-absent` — from `uploadArchive`'s post-transfer
 *   HEAD: the upload finished, but the readback disagreed or found nothing.
 * - `transient` (rclone exit 5) / `fatal` (rclone exit 7), and the
 *   catch-all `rclone-exit:<N>` for any other unmapped exit — all from
 *   `uploadArchive`.
 *
 * Returns `null` for an unrecognized code — callers skip the message line
 * entirely rather than show a guess (the raw code under "Détail technique"
 * still gets shown regardless).
 */
export const mapKnownOffsiteErrorCode = (code: string): string | null => {
  switch (code) {
    case "bucket-missing":
    case "config-error":
      return "Ce réglage se fait sur l'ordinateur, pas dans chiro. Montrez cet écran à la personne qui a installé chiro.";
    case "rclone-spawn-failed":
      return "chiro n'a pas réussi à lancer l'archivage en ligne — transmettez le détail technique.";
    case "verify-failed":
      return "chiro n'a pas pu vérifier que le fichier était bien arrivé en entier — il faut recommencer l'archivage.";
    case "verify-absent":
      return "Le fichier n'a pas été retrouvé en ligne après l'envoi — il faut recommencer l'archivage.";
    case "fatal":
      return "chiro n'a pas réussi à archiver ce fichier, et l'erreur ne se résoudra pas en réessayant — transmettez le détail technique.";
    case "transient":
      return "L'archivage en ligne s'est interrompu de façon inattendue — réessayez, et si ça recommence transmettez le détail technique.";
    default:
      // Any exit code rclone didn't get a dedicated branch for in
      // `uploadArchive.ts` (5 → "transient", 7 → "fatal" are handled above,
      // never as this prefix — see `uploadArchive.test.ts`). Same generic
      // wording as "transient": both mean "rclone ran and refused, for a
      // reason worth a retry".
      return code.startsWith("rclone-exit:")
        ? "L'archivage en ligne s'est interrompu de façon inattendue — réessayez, et si ça recommence transmettez le détail technique."
        : null;
  }
};

/**
 * Codes a retry can never resolve.
 *
 * - `bucket-missing` / `config-error` — rclone refused the call before any
 *   network round-trip; pressing Entrée asks the exact same question.
 * - `rclone-spawn-failed` — an internal chiro bug (the binary it detected at
 *   boot couldn't be launched), not a condition that clears on its own.
 * - `fatal` — rclone's own exit 7, its documented "fatal error" category:
 *   by rclone's own classification this will not resolve on a bare retry.
 *
 * Everything else defaults to transient, mirroring `isTransientArchiveError`'s
 * own asymmetry: a wrongly-transient code costs a few pointless seconds
 * retrying an already-lost cause; a wrongly-definitive one hides an
 * actionable retry from her on what might be a one-off network hiccup.
 * `verify-failed`/`verify-absent` are transient in this sense even though
 * their message says "recommencer" rather than "réessayez" — nothing
 * resumes a partial multipart (A3), so Entrée restarts the whole transfer,
 * which is exactly what "recommencer" already promises.
 */
const DEFINITIVE_OFFSITE_ERROR_CODES = new Set([
  "bucket-missing",
  "config-error",
  "rclone-spawn-failed",
  "fatal",
]);

export const isTransientOffsiteError = (code: string): boolean =>
  !DEFINITIVE_OFFSITE_ERROR_CODES.has(code);
