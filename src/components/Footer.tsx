import { Box, Text } from "ink";

export type FooterHint = {
  /** Single key label, e.g. "Entrée", "Échap", "Tab" */
  key: string;
  /** Human action description, e.g. "valider", "retour au menu" */
  label: string;
};

export type FooterProps = {
  hints: readonly FooterHint[];
};

/**
 * Bottom keyboard-shortcut hint bar.
 *
 * Renders nothing when `hints` is empty (used during sensitive operations
 * where displaying Ctrl+C would invite accidental cancellations).
 */
export const Footer = ({ hints }: FooterProps): React.JSX.Element | null => {
  if (hints.length === 0) return null;
  return (
    <Box marginTop={1}>
      <Text dimColor>
        {hints.map((h, i) => (
          <Text key={`${h.key}-${i.toString()}`}>
            {i > 0 ? "   " : "  "}
            {h.key} {h.label}
          </Text>
        ))}
      </Text>
    </Box>
  );
};
