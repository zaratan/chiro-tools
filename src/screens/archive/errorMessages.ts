import { mapKnownFsErrorCode } from "../fsErrorMessages.js";

/**
 * Both prefixed families wrap an ordinary filesystem code. Whether a failure
 * can resolve itself on a retry is a property of that code alone — the
 * operation it happened during says nothing about a read-only mount.
 *
 * Only the classification looks through the prefix; the *message* for
 * `mkdir:` stays the folder one, which names where it failed.
 */
const PREFIXES_WRAPPING_AN_FS_CODE = ["mkdir:", "rename-volume:"];

const stripFsCodePrefix = (code: string): string => {
  for (const prefix of PREFIXES_WRAPPING_AN_FS_CODE) {
    if (code.startsWith(prefix)) return code.slice(prefix.length);
  }
  return code;
};

/**
 * Maps a raw archive error code (as returned by `createZipArchive`/
 * `createZipVolumes`, or a setup-phase code produced by `useArchiveRun`
 * itself — `mkdir:<X>`, `collision-exhausted`) to a user-facing French
 * message. UI layer translation — the lib keeps raw codes.
 *
 * `dirLabel` is the sub-folder name to mention in the `mkdir:` message
 * (`"archived"` for the backup flow, `"upload"` for the upload-series flow)
 * — a value, not a mode: it can't grow its own branches the way a `mode`
 * flag threaded through every caller would.
 *
 * Returns `null` for an unrecognized code — callers on the run-error screen
 * use this to skip the message line entirely rather than show a guess.
 * `mapArchiveErrorCodeToMessage` below wraps this with the generic fallback
 * for callers that always need a message.
 */
export const mapKnownArchiveErrorCode = (
  code: string,
  dirLabel: string,
): string | null => {
  if (code.startsWith("mkdir:")) {
    return `impossible de créer le sous-dossier « ${dirLabel} »`;
  }
  // Delegating to the bare code keeps the actionable line ("plus de place
  // sur le disque…"); `null` would make the run-error screen drop the
  // message entirely, on the most likely failure of a long run.
  if (code.startsWith("rename-volume:")) {
    return mapKnownArchiveErrorCode(
      code.slice("rename-volume:".length),
      dirLabel,
    );
  }
  const fsMessage = mapKnownFsErrorCode(code);
  if (fsMessage !== null) return fsMessage;
  switch (code) {
    case "ENOENT":
    case "file-changed":
      return "un enregistrement a changé ou disparu pendant la création du zip — réessayez";
    case "verify-failed":
      return "chiro n'a pas pu vérifier que le zip était complet — il n'a pas été conservé, vos enregistrements sont intacts ; réessayez";
    case "entry-too-large":
      return "un enregistrement est trop volumineux pour être mis dans le zip — transmettez le détail technique";
    case "zip64-required":
      return "chiro n'a pas réussi à préparer des fichiers acceptés par Vigie-Chiro — transmettez le détail technique";
    case "collision-exhausted":
      return "trop de fichiers zip portent déjà ce nom — renommez ou rangez ceux du jour, puis réessayez";
    case "staging-stuck":
      return "un dossier de travail d'un essai précédent n'a pas pu être supprimé — il est caché dans « upload » et commence par un point ; supprimez-le puis relancez";
    default:
      return null;
  }
};

export const mapArchiveErrorCodeToMessage = (
  code: string,
  dirLabel: string,
): string =>
  mapKnownArchiveErrorCode(code, dirLabel) ??
  `erreur inattendue (code: ${code})`;

/**
 * Codes a retry can never resolve. Offering `Entrée réessayer` to someone who
 * just waited twelve minutes, for an attempt that cannot succeed, is the
 * worst trust leak in the flow — so anything not listed here defaults to
 * transient, which at least leaves her an action.
 *
 * - `zip64-required` — internal bug; the guard tripped.
 * - `entry-too-large` — deterministic; the file is simply too big.
 * - `EROFS` — a mount does not become writable between two key presses, and
 *   its own message already tells her to copy the files elsewhere.
 * - `staging-stuck` — a retry re-runs the cleanup that just failed.
 *
 * `EACCES`/`EPERM` stay transient on purpose: a permission really can be
 * lifted from outside without moving anything.
 */
const DEFINITIVE_ARCHIVE_ERROR_CODES = new Set([
  "zip64-required",
  "entry-too-large",
  "EROFS",
  "staging-stuck",
]);

/** A read-only mount surfaces as `mkdir:EROFS` — the first `mkdir` is what
 * fails — never as a bare `EROFS`, hence the prefix stripping. */
export const isTransientArchiveError = (code: string): boolean =>
  !DEFINITIVE_ARCHIVE_ERROR_CODES.has(stripFsCodePrefix(code));
