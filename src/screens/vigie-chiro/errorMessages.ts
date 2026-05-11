/**
 * Maps a raw FS error code (as returned by `applyRenames`) to a user-facing
 * French message. Lives in `src/screens/` (UI layer) — the lib layer keeps
 * raw codes, the screens translate.
 */
export const mapErrorCodeToMessage = (code: string): string => {
  if (code.startsWith("DUPLICATED")) {
    return "le fichier a été copié mais l'original n'a pas pu être supprimé — vérifiez manuellement et supprimez le doublon";
  }
  switch (code) {
    case "EEXIST":
      return "un fichier portant le nom cible existe déjà — non remplacé";
    case "EACCES":
    case "EPERM":
      return "permission refusée par le système";
    case "ENOENT":
      return "le fichier a disparu pendant l'opération";
    default:
      return `erreur inattendue (code: ${code})`;
  }
};
