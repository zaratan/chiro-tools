import { Box, Text, useInput } from "ink";
import { useMemo, useState } from "react";
import { Footer } from "../components/Footer.js";

type MenuItem =
  | "vigie-prefix"
  | "vigie-process"
  | "package"
  | "backup"
  | "offsite"
  | "update"
  | "quit";

const ITEMS: { id: MenuItem; label: string }[] = [
  {
    id: "vigie-prefix",
    label: "Préfixer des enregistrements pour Vigie-Chiro",
  },
  {
    id: "vigie-process",
    label: "Découper les enregistrements (pour Tadarida)",
  },
  {
    id: "package",
    label: "Créer les zips à déposer sur Vigie-Chiro",
  },
  {
    id: "backup",
    label: "Sauvegarder les enregistrements découpés (un seul zip)",
  },
  { id: "offsite", label: "Archiver la sauvegarde en ligne" },
  { id: "update", label: "Vérifier les mises à jour" },
  { id: "quit", label: "Quitter" },
];

export type MenuScreenProps = {
  onPickVigiePrefix: () => void;
  onPickVigieProcess: () => void;
  onPickPackage: () => void;
  onPickBackup: () => void;
  onPickOffsite: () => void;
  onPickUpdate: () => void;
  onQuit: () => void;
  availableVersion: string | null;
  autoUpdateDisabled?: boolean;
  /** Gates the "Archiver la sauvegarde en ligne" entry — shown only when
   * rclone was detected and `~/.chiro/settings.json` is valid at boot (cf.
   * `resolveOffsiteAvailability`). Absent, this entry vanishes in total
   * silence, same contract as `autoUpdateDisabled`. */
  offsiteAvailable?: boolean;
};

export const MenuScreen = ({
  onPickVigiePrefix,
  onPickVigieProcess,
  onPickPackage,
  onPickBackup,
  onPickOffsite,
  onPickUpdate,
  onQuit,
  availableVersion,
  autoUpdateDisabled = false,
  offsiteAvailable = false,
}: MenuScreenProps): React.JSX.Element => {
  const [focused, setFocused] = useState(0);

  // Derived rather than a module-level constant: two independent gates
  // (update, offsite) each conditionally drop an entry.
  const items = useMemo(
    () =>
      ITEMS.filter((item) => {
        if (item.id === "update") return !autoUpdateDisabled;
        if (item.id === "offsite") return offsiteAvailable;
        return true;
      }),
    [autoUpdateDisabled, offsiteAvailable],
  );

  useInput((_input, key) => {
    if (key.upArrow) {
      setFocused((f) => (f === 0 ? items.length - 1 : f - 1));
      return;
    }
    if (key.downArrow) {
      setFocused((f) => (f === items.length - 1 ? 0 : f + 1));
      return;
    }
    if (key.escape) {
      onQuit();
      return;
    }
    if (key.return) {
      const item = items[focused];
      if (!item) return;
      if (item.id === "update") onPickUpdate();
      else if (item.id === "vigie-prefix") onPickVigiePrefix();
      else if (item.id === "vigie-process") onPickVigieProcess();
      else if (item.id === "package") onPickPackage();
      else if (item.id === "backup") onPickBackup();
      else if (item.id === "offsite") onPickOffsite();
      else onQuit();
    }
  });

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
      <Text bold color="cyan">
        chiro — outils Vigie-Chiro
      </Text>
      <Box marginTop={1}>
        <Text>Que voulez-vous faire ?</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {items.map((item, i) => {
          const isFocused = i === focused;
          return (
            <Box key={item.id}>
              <Text color={isFocused ? "cyan" : undefined}>
                {isFocused ? "▸ " : "  "}
              </Text>
              <Text bold={isFocused}>{item.label}</Text>
            </Box>
          );
        })}
      </Box>
      {availableVersion !== null && !autoUpdateDisabled && (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">
            {`⚠ Une mise à jour est disponible (${availableVersion}).`}
          </Text>
          <Text dimColor>
            {"  Choisissez « Vérifier les mises à jour » pour l'installer."}
          </Text>
        </Box>
      )}
      <Footer
        hints={[
          { key: "↑↓", label: "choisir" },
          { key: "Entrée", label: "valider" },
          { key: "Échap", label: "quitter" },
        ]}
      />
    </Box>
  );
};
