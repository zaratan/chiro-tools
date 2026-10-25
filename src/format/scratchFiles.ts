export const formatScratchFilesIgnored = (count: number): string =>
  count > 1
    ? `(${count.toString()} fichiers temporaires de l'enregistreur ignorés)`
    : "(1 fichier temporaire de l'enregistreur ignoré)";
