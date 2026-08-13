import { mapKnownFsErrorCode } from "../fsErrorMessages.js";

/**
 * Maps a raw FS error code (as returned by `applyRenames`) to a user-facing
 * French message. Lives in `src/screens/` (UI layer) — the lib layer keeps
 * raw codes, the screens translate.
 *
 * Returns `null` for an unrecognized code — callers on the run-error screen
 * use this to skip the message line entirely rather than show a guess.
 * `mapErrorCodeToMessage` below wraps this with the generic fallback for
 * the Résultat screen, which always needs a message per error group.
 */
export const mapKnownErrorCode = (code: string): string | null => {
  if (code.startsWith("DUPLICATED")) {
    return "le fichier a été copié mais l'original n'a pas pu être supprimé — vérifiez manuellement et supprimez le doublon";
  }
  const fsMessage = mapKnownFsErrorCode(code);
  if (fsMessage !== null) return fsMessage;
  switch (code) {
    case "EEXIST":
      return "un fichier portant le nom cible existe déjà — non remplacé";
    case "ENOENT":
      return "le fichier a disparu pendant l'opération";
    default:
      return null;
  }
};

export const mapErrorCodeToMessage = (code: string): string =>
  mapKnownErrorCode(code) ?? `erreur inattendue (code: ${code})`;
