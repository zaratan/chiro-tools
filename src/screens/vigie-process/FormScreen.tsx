import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { Footer } from "../../components/Footer.js";
import type { ProcessInput, TimeExpansionMode } from "../../types.js";

type Option = {
  mode: TimeExpansionMode;
  label: string;
};

const OPTIONS: readonly Option[] = [
  {
    mode: "preserve",
    label: "Boîtier PaRec (Teensy) — fichiers déjà au bon format",
  },
  {
    mode: "expand-10x",
    label: "Autre détecteur — fichiers à ralentir 10× pour l'analyse",
  },
];

export type ProcessFormScreenProps = {
  onSubmit: (input: ProcessInput) => void;
  onBack: () => void;
};

export const FormScreen = ({
  onSubmit,
  onBack,
}: ProcessFormScreenProps): React.JSX.Element => {
  const [focused, setFocused] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) {
      setFocused((f) => (f === 0 ? OPTIONS.length - 1 : f - 1));
      return;
    }
    if (key.downArrow) {
      setFocused((f) => (f === OPTIONS.length - 1 ? 0 : f + 1));
      return;
    }
    if (key.escape) {
      onBack();
      return;
    }
    if (key.return) {
      const option = OPTIONS[focused];
      if (!option) return;
      onSubmit({ mode: option.mode });
    }
  });

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
      <Text bold>Quel type d'enregistreur a produit ces fichiers ?</Text>
      <Box flexDirection="column" marginTop={1}>
        {OPTIONS.map((option, i) => {
          const isFocused = i === focused;
          return (
            <Box key={option.mode}>
              <Text color={isFocused ? "cyan" : undefined}>
                {isFocused ? "▸ " : "  "}
              </Text>
              <Text bold={isFocused}>{option.label}</Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          Les détecteurs full-spectrum (AudioMoth, SM4, etc.) enregistrent à
          très haute fréquence — il faut les ralentir pour pouvoir les analyser.
          Le boîtier PaRec le fait déjà à l'enregistrement.
        </Text>
      </Box>
      <Footer
        hints={[
          { key: "↑↓", label: "choisir" },
          { key: "Entrée", label: "valider" },
          { key: "Échap", label: "retour" },
        ]}
      />
    </Box>
  );
};
