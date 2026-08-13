import { Box, Text, useInput } from "ink";
import path from "node:path";
import { Footer } from "../../components/Footer.js";
import { PROCESSED_DIR_DISPLAY } from "../../lib/audio/batchPlan.js";
import { ARCHIVED_DIR_DISPLAY } from "../../lib/archive/planArchive.js";
import { formatBytes } from "../../lib/format/bytes.js";
import { formatDuration } from "../../lib/format/duration.js";
import type { ArchiveRunOutcome } from "./useArchiveRun.js";

export type ArchiveResultScreenProps = {
  outcome: ArchiveRunOutcome;
  onBackToMenu: () => void;
};

export const ResultScreen = ({
  outcome,
  onBackToMenu,
}: ArchiveResultScreenProps): React.JSX.Element => {
  useInput((_input, key) => {
    if (key.return) onBackToMenu();
  });

  if (outcome.kind === "aborted") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text color="cyan">ℹ Création du zip arrêtée à votre demande</Text>
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

  // outcome.kind === "ok"
  return (
    <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
      <Text color="green" bold>
        ✓ Terminé !
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          {`  ${outcome.entryCount.toString()} enregistrement${
            outcome.entryCount > 1 ? "s" : ""
          } rassemblé${outcome.entryCount > 1 ? "s" : ""} dans un fichier zip`}
        </Text>
        <Text>
          {`  ${ARCHIVED_DIR_DISPLAY}${path.basename(outcome.zipPath)}`}
        </Text>
        <Text>{`  Taille : ${formatBytes(outcome.zipBytes)}`}</Text>
        <Text dimColor>
          {`  Temps écoulé : ${formatDuration(outcome.durationMs / 1000)}`}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text>Vous pouvez maintenant déposer ce fichier sur Vigie-Chiro.</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          {`Vos enregistrements sont toujours dans ${PROCESSED_DIR_DISPLAY}.`}
        </Text>
      </Box>
      <Footer hints={[{ key: "Entrée", label: "retour au menu" }]} />
    </Box>
  );
};
