import { Box, Text, useInput } from "ink";
import path from "node:path";
import { Footer } from "../../components/Footer.js";
import { PROCESSED_DIR_DISPLAY } from "../../lib/audio/batchPlan.js";
import { ARCHIVED_DIR_DISPLAY } from "../../lib/archive/planArchive.js";
import { formatBytes } from "../../format/bytes.js";
import { formatDuration } from "../../format/duration.js";
import type { ArchiveRunOutcome } from "./useArchiveRun.js";

/** The backup flow's own outcomes — never `package-ok` (that's
 * `UploadResultScreen`'s territory). */
export type BackupRunOutcome = Extract<
  ArchiveRunOutcome,
  { kind: "backup-ok" } | { kind: "aborted" }
>;

export type ArchiveResultScreenProps = {
  cwd: string;
  outcome: BackupRunOutcome;
  onBackToMenu: () => void;
};

export const ResultScreen = ({
  cwd,
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

  // outcome.kind === "backup-ok"
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
      <Box marginTop={1} flexDirection="column">
        <Text>
          Ce fichier est votre copie de sauvegarde : gardez-le de côté.
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>ℹ Pour déposer sur Vigie-Chiro, choisissez</Text>
        <Text>
          {"  « Créer les zips à déposer sur Vigie-Chiro » dans le menu."}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {/* The zip path above is relative; without the absolute cwd the user
            has no way to locate the file she is being told to upload. */}
        <Text dimColor>📁 {cwd}</Text>
        <Text dimColor>
          {`Vos enregistrements sont toujours dans ${PROCESSED_DIR_DISPLAY}.`}
        </Text>
      </Box>
      <Footer hints={[{ key: "Entrée", label: "retour au menu" }]} />
    </Box>
  );
};
