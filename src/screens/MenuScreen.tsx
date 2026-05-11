import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { Footer } from "../components/Footer.js";

type MenuItem = "vigie-prefix" | "quit";

const ITEMS: { id: MenuItem; label: string }[] = [
  {
    id: "vigie-prefix",
    label: "Préfixer des enregistrements pour Vigie-Chiro",
  },
  { id: "quit", label: "Quitter" },
];

export type MenuScreenProps = {
  onPickVigiePrefix: () => void;
  onQuit: () => void;
};

export const MenuScreen = ({
  onPickVigiePrefix,
  onQuit,
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
      if (item.id === "vigie-prefix") onPickVigiePrefix();
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
