import { Box, Text, useInput } from "ink";
import { formatBytes } from "../../format/bytes.js";
import { formatTimeOfDay } from "../../format/date.js";
import { formatDuration } from "../../format/duration.js";
import { ARCHIVED_DIR_DISPLAY } from "../../lib/archive/planArchive.js";
import { estimateUploadSeconds } from "../../lib/offsite/estimatedDuration.js";
import { Footer } from "../../components/Footer.js";
import {
  isTransientOffsiteError,
  mapKnownOffsiteErrorCode,
} from "./errorMessages.js";

export type OffsiteResultOutcome =
  | {
      kind: "ok";
      zipName: string;
      zipBytes: number;
      verified: "size-match" | "unavailable";
      finishedAtMs: number;
      durationMs: number;
    }
  | { kind: "aborted" }
  | { kind: "run-error"; code: string; zipBytes: number };

export type OffsiteResultScreenProps = {
  cwd: string;
  outcome: OffsiteResultOutcome;
  /** "Entrée" on `ok`/`aborted`. Unused (but still required — the caller
   * always has a menu to go back to) on `run-error`, where Entrée retries
   * and Échap is what leaves the screen. */
  onBackToMenu: () => void;
  /** Restarts the transfer from byte 0. Only wired from `run-error`, and
   * only offered there when the code is transient. */
  onRetry?: () => void;
  /** Back to the confirmation screen. Only wired from `run-error`. */
  onBackToStart?: () => void;
};

const renderVerifiedLine = (
  verified: "size-match" | "unavailable",
): React.JSX.Element => {
  if (verified === "size-match") {
    return (
      <Text>chiro a vérifié que le fichier est bien arrivé, en entier.</Text>
    );
  }
  // Split by hand at the same width as the rest of the app's manual
  // wraps (docs/ux.md, 66 usable columns) — a success message, not an
  // apology: the word "échec"/"erreur" never appears here.
  return (
    <Box flexDirection="column">
      <Text>{"L'envoi s'est terminé normalement. chiro n'a pas réussi à"}</Text>
      <Text>{"revérifier en ligne juste après ; le fichier est très"}</Text>
      <Text>{"probablement bien arrivé."}</Text>
    </Box>
  );
};

export const ResultScreen = ({
  cwd,
  outcome,
  onBackToMenu,
  onRetry,
  onBackToStart,
}: OffsiteResultScreenProps): React.JSX.Element => {
  useInput((_input, key) => {
    if (outcome.kind === "run-error") {
      if (key.return && isTransientOffsiteError(outcome.code)) {
        onRetry?.();
        return;
      }
      if (key.escape) {
        onBackToStart?.();
      }
      return;
    }
    if (key.return) {
      onBackToMenu();
    }
  });

  if (outcome.kind === "aborted") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text color="cyan">ℹ Archivage en ligne arrêté à votre demande</Text>
        <Box marginTop={1}>
          <Text>Le fichier n'a pas été archivé.</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>
            {`Rien n'a été modifié : votre sauvegarde est intacte dans ${ARCHIVED_DIR_DISPLAY}. Vous pouvez recommencer quand vous voudrez.`}
          </Text>
        </Box>
        <Footer hints={[{ key: "Entrée", label: "retour au menu" }]} />
      </Box>
    );
  }

  if (outcome.kind === "run-error") {
    const knownMessage = mapKnownOffsiteErrorCode(outcome.code);
    const transient = isTransientOffsiteError(outcome.code);
    const restartEstimate = formatDuration(
      estimateUploadSeconds(outcome.zipBytes),
    );
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text color="yellow">
          ⚠ Une erreur est survenue pendant l'archivage en ligne.
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>
            {`Le fichier n'a pas été archivé — votre sauvegarde est intacte dans ${ARCHIVED_DIR_DISPLAY}.`}
          </Text>
        </Box>
        {knownMessage !== null ? (
          <Box marginTop={1} flexDirection="column">
            <Text>{knownMessage}</Text>
          </Box>
        ) : null}
        <Box marginTop={1} flexDirection="column">
          <Text>
            Détail technique : <Text color="cyan">{outcome.code}</Text>
          </Text>
          <Text dimColor>{"  (à transmettre si vous demandez de l'aide)"}</Text>
          {transient ? (
            <Text dimColor>
              {`  (l'archivage reprend depuis le début, comptez environ ${restartEstimate})`}
            </Text>
          ) : null}
        </Box>
        <Footer
          hints={
            transient
              ? [
                  { key: "Entrée", label: "réessayer" },
                  { key: "Échap", label: "revenir au début" },
                ]
              : [{ key: "Échap", label: "revenir au début" }]
          }
        />
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
        <Text>{"  Votre sauvegarde est archivée en ligne."}</Text>
        <Text>{`  ${outcome.zipName}`}</Text>
        <Text>{`  Taille : ${formatBytes(outcome.zipBytes)}`}</Text>
        <Text>
          {`  Terminé à ${formatTimeOfDay(new Date(outcome.finishedAtMs))}, après ${formatDuration(outcome.durationMs / 1000)}`}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {renderVerifiedLine(outcome.verified)}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>Gardez votre copie locale tant que vous avez la place :</Text>
        <Text>deux copies valent mieux qu'une.</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>📁 {cwd}</Text>
        <Text dimColor>
          {`Votre sauvegarde est toujours dans ${ARCHIVED_DIR_DISPLAY}.`}
        </Text>
      </Box>
      <Footer hints={[{ key: "Entrée", label: "retour au menu" }]} />
    </Box>
  );
};
