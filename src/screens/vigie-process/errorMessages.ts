/**
 * Maps a raw process error code (as returned by `processWavFiles`) to a
 * user-facing French message. UI layer translation — the lib keeps raw codes.
 */
export const mapProcessErrorCodeToMessage = (code: string): string => {
  if (code.startsWith("write:")) {
    const inner = code.slice("write:".length);
    if (inner === "ENOSPC") {
      return "plus de place sur le disque — libérez de l'espace puis relancez";
    }
    if (inner === "EACCES" || inner === "EPERM") {
      return "permission refusée par le système";
    }
    return `écriture impossible (code: ${inner})`;
  }
  if (code.startsWith("mkdir:")) {
    return "impossible de créer le sous-dossier « processed »";
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
    default:
      return `erreur inattendue (code: ${code})`;
  }
};
