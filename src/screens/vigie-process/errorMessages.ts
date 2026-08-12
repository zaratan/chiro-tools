/**
 * Maps a raw process error code (as returned by `processWavFiles`) to a
 * user-facing French message. UI layer translation — the lib keeps raw codes.
 *
 * Returns `null` for an unrecognized code — callers on the run-error screen
 * use this to skip the message line entirely rather than show a guess.
 * `mapProcessErrorCodeToMessage` below wraps this with the generic fallback
 * for the Résultat screen, which always needs a message per error group.
 */
export const mapKnownProcessErrorCode = (code: string): string | null => {
  if (code.startsWith("mkdir:")) {
    return "impossible de créer le sous-dossier « processed »";
  }
  if (code.startsWith("sox-") || code.startsWith("non-aligned-data-size")) {
    return "chiro n'a pas réussi à traiter cet enregistrement — réessayez, et si ça recommence transmettez le détail technique";
  }
  switch (code) {
    case "invalid-header":
      return "fichier illisible — peut-être corrompu pendant le transfert";
    case "unsupported-format":
      return "format audio inhabituel — non géré pour l'instant";
    case "unsupported-bit-depth":
      return "résolution audio non supportée (16 ou 24 bits uniquement)";
    case "no-samples":
      return "fichier sans contenu audio";
    case "ENOENT":
      return "le fichier a disparu pendant l'opération";
    case "EACCES":
    case "EPERM":
      return "permission refusée par le système";
    case "ENOSPC":
      return "plus de place sur le disque — libérez de l'espace puis relancez";
    case "EROFS":
      return "ce disque est protégé en écriture — copiez les fichiers ailleurs puis relancez";
    case "EXDEV":
      return "impossible de déplacer le fichier d'un disque à un autre (carte SD, disque externe…)";
    case "worker-died":
    case "worker-spawn-failed":
    case "no-workers-available":
      return "le découpage s'est interrompu de façon inattendue — réessayez, et si ça recommence transmettez le détail technique";
    default:
      return null;
  }
};

export const mapProcessErrorCodeToMessage = (code: string): string =>
  mapKnownProcessErrorCode(code) ?? `erreur inattendue (code: ${code})`;
