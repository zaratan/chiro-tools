import { mapKnownFsErrorCode } from "../fsErrorMessages.js";

/**
 * Maps a raw archive error code (as returned by `createZipArchive`, or a
 * setup-phase code produced by `useArchiveRun` itself — `mkdir:<X>`,
 * `collision-exhausted`) to a user-facing French message. UI layer
 * translation — the lib keeps raw codes.
 *
 * Returns `null` for an unrecognized code — callers on the run-error screen
 * use this to skip the message line entirely rather than show a guess.
 * `mapArchiveErrorCodeToMessage` below wraps this with the generic fallback
 * for callers that always need a message.
 */
export const mapKnownArchiveErrorCode = (code: string): string | null => {
  if (code.startsWith("mkdir:")) {
    return "impossible de créer le sous-dossier « archived »";
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
    case "collision-exhausted":
      return "plusieurs zips ont déjà été créés dans la même minute — patientez une minute puis réessayez";
    default:
      return null;
  }
};

export const mapArchiveErrorCodeToMessage = (code: string): string =>
  mapKnownArchiveErrorCode(code) ?? `erreur inattendue (code: ${code})`;
