import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { Footer } from "../components/Footer.js";

type MenuItem = "vigie-prefix" | "vigie-process" | "update" | "quit";

const ITEMS: { id: MenuItem; label: string }[] = [
  {
    id: "vigie-prefix",
    label: "Préfixer des enregistrements pour Vigie-Chiro",
  },
  {
    id: "vigie-process",
    label: "Découper les enregistrements (pour Tadarida)",
  },
  { id: "update", label: "Vérifier les mises à jour" },
  { id: "quit", label: "Quitter" },
];

export type MenuScreenProps = {
  onPickVigiePrefix: () => void;
  onPickVigieProcess: () => void;
  onPickUpdate: () => void;
  onQuit: () => void;
  availableVersion: string | null;
};

export const MenuScreen = ({
  onPickVigiePrefix,
  onPickVigieProcess,
  onPickUpdate,
  onQuit,
  availableVersion,
}: MenuScreenProps): React.JSX.Element => {
  const [focused, setFocused] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) {
      setFocused((f) => (f === 0 ? ITEMS.length - 1 : f - 1));
      return;
    }
    if (key.downArrow) {
      setFocused((f) => (f === ITEMS.length - 1 ? 0 : f + 1));
      return;
    }
    if (key.escape) {
      onQuit();
      return;
    }
    if (key.return) {
      const item = ITEMS[focused];
      if (!item) return;
      if (item.id === "update") onPickUpdate();
      else if (item.id === "vigie-prefix") onPickVigiePrefix();
      else if (item.id === "vigie-process") onPickVigieProcess();
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
        {ITEMS.map((item, i) => {
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
      {availableVersion !== null && (
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
