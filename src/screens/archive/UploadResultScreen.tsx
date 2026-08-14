import { Box, Text, useInput } from "ink";
import { Footer } from "../../components/Footer.js";
import { PROCESSED_DIR_DISPLAY } from "../../lib/audio/batchPlan.js";
import { UPLOAD_DIR_DISPLAY } from "../../lib/archive/planUpload.js";
import { formatBytes } from "../../format/bytes.js";
import { formatDuration } from "../../format/duration.js";
import type { ArchiveRunOutcome } from "./useArchiveRun.js";

/** The upload-series flow's own outcomes — never `backup-ok` (that's
 * `ResultScreen`'s territory). */
export type PackageRunOutcome = Extract<
  ArchiveRunOutcome,
  { kind: "package-ok" } | { kind: "aborted" }
>;

export type UploadResultScreenProps = {
  cwd: string;
  outcome: PackageRunOutcome;
  onBackToMenu: () => void;
};

export const UploadResultScreen = ({
  cwd,
  outcome,
  onBackToMenu,
}: UploadResultScreenProps): React.JSX.Element => {
  useInput((_input, key) => {
    if (key.return) onBackToMenu();
  });

  if (outcome.kind === "aborted") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text color="cyan">ℹ Préparation du dépôt arrêtée à votre demande</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Aucun fichier zip n'a été créé.</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>
            {`Rien n'a été modifié : vos enregistrements sont intacts dans ${PROCESSED_DIR_DISPLAY}. Vous pouvez recommencer quand vous voudrez.`}
          </Text>
        </Box>
        <Footer hints={[{ key: "Entrée", label: "retour au menu" }]} />
      </Box>
    );
  }

  // outcome.kind === "package-ok"
  const volumeCount = outcome.volumes.length;
  const single = volumeCount <= 1;
  const entryCount = outcome.entryCount;
  const entryPlural = entryCount > 1 ? "s" : "";

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
      <Text color="green" bold>
        ✓ Terminé !
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          {single
            ? `  ${entryCount.toString()} enregistrement${entryPlural} rassemblé${entryPlural} dans un fichier zip`
            : `  ${entryCount.toString()} enregistrement${entryPlural} réparti${entryPlural} dans ${volumeCount.toString()} fichiers zip`}
        </Text>
        <Text>{`  ${UPLOAD_DIR_DISPLAY}${outcome.seriesDirName}/`}</Text>
        <Text>{`  Taille totale : ${formatBytes(outcome.totalZipBytes)}`}</Text>
        <Text dimColor>
          {`  Temps écoulé : ${formatDuration(outcome.durationMs / 1000)}`}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>
          {single
            ? "Déposez ce fichier sur Vigie-Chiro."
            : `Déposez les ${volumeCount.toString()} fichiers sur Vigie-Chiro, un par un.`}
        </Text>
        {!single ? <Text>L'ordre n'a pas d'importance.</Text> : null}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>ℹ Vous pouvez aussi garder une copie complète de côté :</Text>
        <Text>
          {"  choisissez « Sauvegarder les enregistrements découpés »."}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>📁 {cwd}</Text>
        <Text dimColor>
          {`Vos enregistrements sont toujours dans ${PROCESSED_DIR_DISPLAY}.`}
        </Text>
      </Box>
      <Footer hints={[{ key: "Entrée", label: "retour au menu" }]} />
    </Box>
  );
};
