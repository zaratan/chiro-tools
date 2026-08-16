import { mapKnownFsErrorCode } from "../fsErrorMessages.js";

/**
 * Maps a raw archive error code (as returned by `createZipArchive`/
 * `createZipVolumes`, or a setup-phase code produced by `useArchiveRun`
 * itself — `mkdir:<X>`, `collision-exhausted`) to a user-facing French
 * message. UI layer translation — the lib keeps raw codes.
 *
 * `dirLabel` is the sub-folder name to mention in the `mkdir:` message
 * (`"archived"` for the backup flow, `"upload"` for the upload-series flow)
 * — a value, not a mode: it can't grow its own branches the way a `mode`
 * flag threaded through every caller would (phase-9 plan, D7).
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
  // `rename-volume:<fsCode>` carries an ordinary filesystem failure that
  // happens to occur while naming the volumes. Delegating to the bare code
  // keeps the actionable line ("plus de place sur le disque…") instead of
  // falling through to `null`, which makes the run-error screen drop the
  // message entirely — on what is the most likely failure of a long run.
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
 * Codes that can never resolve themselves on a retry: `zip64-required` is an
 * internal bug (the guard tripped, no amount of retrying changes that),
 * `entry-too-large` is deterministic — the file is just too big, every
 * retry fails the same way — and `EROFS` describes a mount that will not
 * become writable between two key presses. That last one also contradicts
 * itself on screen: its own message tells her to copy the files elsewhere
 * and start again, while the footer offers to retry here.
 *
 * `EACCES`/`EPERM` stay transient on purpose: a permission really can be
 * fixed from outside (closing whatever holds the file) without moving
 * anything, and their message makes no competing promise.
 *
 * Everything else (disk full since freed, a file that moved, a transient
 * verify failure…) genuinely can succeed on a second attempt, so it defaults
 * to `true`: offering a retry that cannot possibly work, to someone who may
 * have just waited 12 minutes for the failure, is worse than not knowing.
 */
const DEFINITIVE_ARCHIVE_ERROR_CODES = new Set([
  "zip64-required",
  "entry-too-large",
  "EROFS",
]);

export const isTransientArchiveError = (code: string): boolean =>
  !DEFINITIVE_ARCHIVE_ERROR_CODES.has(code);
