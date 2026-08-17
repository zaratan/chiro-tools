import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { Footer } from "../../components/Footer.js";
import { formatBytes } from "../../format/bytes.js";
import { formatDuration } from "../../format/duration.js";
import { fitPath } from "../../format/path.js";
import { estimateUploadSeconds } from "../../lib/offsite/estimatedDuration.js";
import type { ChosenArchive } from "../../lib/offsite/pickArchiveToUpload.js";
import {
  readPowerState as defaultReadPowerState,
  type PowerState,
} from "../../lib/offsite/powerState.js";

export type OffsiteConfirmScreenProps = {
  cwd: string;
  chosen: ChosenArchive;
  onConfirm: () => void;
  onBack: () => void;
  /** Test seam. Defaults to the real readPowerState. */
  readPowerState?: () => PowerState;
};

/** Right-pads a label so every value in the column block starts at the same
 * column, however long its own label is — the block "must never wrap". */
const LABELS = ["Nom du fichier :", "Taille :", "Durée prévue :"] as const;
const LABEL_WIDTH = Math.max(...LABELS.map((label) => label.length));
const padLabel = (label: string): string => label.padEnd(LABEL_WIDTH + 1);

const estimatedDurationLabel = (bytes: number): string =>
  `environ ${formatDuration(estimateUploadSeconds(bytes))} (selon votre connexion)`;

export const ConfirmScreen = ({
  cwd,
  chosen,
  onConfirm,
  onBack,
  readPowerState = defaultReadPowerState,
}: OffsiteConfirmScreenProps): React.JSX.Element => {
  // Read once at mount, not on every render — `readPowerState` spawns
  // `pmset` synchronously.
  const [powerState] = useState<PowerState>(() => readPowerState());
  const onBattery = powerState === "battery";

  useInput((_input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.return) {
      onConfirm();
    }
  });

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
      <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
      <Box marginTop={1}>
        <Text>On va archiver votre sauvegarde en ligne.</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>
          {padLabel("Nom du fichier :")}
          <Text color="cyan">{chosen.name}</Text>
        </Text>
        <Text>
          {padLabel("Taille :")}
          <Text color="cyan">{formatBytes(chosen.size)}</Text>
        </Text>
        <Text>
          {padLabel("Durée prévue :")}
          <Text color="cyan">{estimatedDurationLabel(chosen.size)}</Text>
        </Text>
      </Box>
      {onBattery ? (
        <Box marginTop={1} flexDirection="column">
          {/* Split by hand, and kept to two lines: Ink's wrapper starts the
              continuation at column 1 instead of indenting it under the ⚠,
              and a third line would push the screen past its 24-row budget. */}
          <Text color="yellow">
            {"⚠ L'ordinateur n'est pas branché sur le secteur. La batterie"}
          </Text>
          <Text color="yellow">
            {"  s'épuisera et l'archivage s'arrêtera. Branchez-le d'abord."}
          </Text>
        </Box>
      ) : null}
      {/* No blank line above this block on battery: the warning already
          separates it from the aligned column block, and the screen must
          stay at or under 24 rows on an 80×24 terminal — with the battery
          block's own 3 rows added, this is the row the budget has to give
          back. */}
      <Box marginTop={onBattery ? 0 : 1} flexDirection="column">
        <Text>
          Vous n'avez rien à surveiller : chiro continue tout seul, et le
          résultat restera affiché jusqu'à ce que vous reveniez.{" "}
          {onBattery
            ? "Pendant ce temps, laissez cette fenêtre ouverte, ne rabattez pas l'écran."
            : "Pendant ce temps, laissez cette fenêtre ouverte, ne rabattez pas l'écran, et laissez l'ordinateur branché sur le secteur."}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {/* Split by hand: left to Ink's wrapper this breaks after "Votre" and
            starts the next row with a leading space. */}
        <Text>
          {"Vous pourrez arrêter en cours de route (Ctrl et C ensemble)."}
        </Text>
        <Text>{"Votre fichier n'est ni déplacé ni supprimé."}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Destination : stockage en ligne Scaleway</Text>
      </Box>
      <Footer
        hints={[
          { key: "Entrée", label: "archiver" },
          { key: "Échap", label: "revenir au début" },
        ]}
      />
    </Box>
  );
};
