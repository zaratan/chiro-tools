import { Box, Text, useInput } from "ink";
import path from "node:path";
import { Footer } from "../../components/Footer.js";
import { PROCESSED_DIR_DISPLAY } from "../../lib/audio/batchPlan.js";
import { ARCHIVED_DIR_DISPLAY } from "../../lib/archive/planArchive.js";
import { formatBytes } from "../../format/bytes.js";
import { formatDuration } from "../../format/duration.js";
import { estimateUploadSeconds } from "../../lib/offsite/estimatedDuration.js";
import type { ArchiveRunOutcome, BackupOkResult } from "./useArchiveRun.js";

/** The backup flow's own outcomes. */
export type BackupRunOutcome = ArchiveRunOutcome<BackupOkResult>;

export type ArchiveResultScreenProps = {
  cwd: string;
  outcome: BackupRunOutcome;
  onBackToMenu: () => void;
  /** Gates the "A archiver en ligne" proposal below the success message —
   * same availability the menu's own offsite entry is gated on. When false,
   * this screen renders exactly as it did before Phase 10: one hand-off
   * line, no bullet list, no `A` hint. */
  offsiteAvailable?: boolean;
  onArchiveOffsite?: () => void;
};

export const ResultScreen = ({
  cwd,
  outcome,
  onBackToMenu,
  offsiteAvailable = false,
  onArchiveOffsite,
}: ArchiveResultScreenProps): React.JSX.Element => {
  useInput((input, key) => {
    if (key.return) {
      onBackToMenu();
      return;
    }
    if (
      offsiteAvailable &&
      outcome.kind === "backup-ok" &&
      input.toLowerCase() === "a"
    ) {
      onArchiveOffsite?.();
    }
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
      {offsiteAvailable ? (
        <Box marginTop={1} flexDirection="column">
          <Text>ℹ Et maintenant :</Text>
          <Text>
            {"  • pour déposer sur Vigie-Chiro, choisissez « Créer les zips à"}
          </Text>
          <Text>{"    déposer sur Vigie-Chiro » dans le menu"}</Text>
          <Text>
            {"  • pour garder cette sauvegarde à l'abri d'une panne de disque,"}
          </Text>
          <Text>
            {`    appuyez sur A (comptez environ ${formatDuration(estimateUploadSeconds(outcome.zipBytes))})`}
          </Text>
        </Box>
      ) : (
        <Box marginTop={1} flexDirection="column">
          <Text>ℹ Pour déposer sur Vigie-Chiro, choisissez</Text>
          <Text>
            {"  « Créer les zips à déposer sur Vigie-Chiro » dans le menu."}
          </Text>
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        {/* The zip path above is relative; without the absolute cwd the user
            has no way to locate the file she is being told to upload. */}
        <Text dimColor>📁 {cwd}</Text>
        <Text dimColor>
          {`Vos enregistrements sont toujours dans ${PROCESSED_DIR_DISPLAY}.`}
        </Text>
      </Box>
      <Footer
        hints={
          offsiteAvailable
            ? [
                { key: "A", label: "archiver en ligne" },
                { key: "Entrée", label: "retour au menu" },
              ]
            : [{ key: "Entrée", label: "retour au menu" }]
        }
      />
    </Box>
  );
};
