import { Box, Text, useInput } from "ink";
import { Footer } from "./Footer.js";

const MAX_VISIBLE_NAMES = 4;

export type DuplicateNamesScreenProps = {
  names: readonly string[];
  onBack: () => void;
};

/**
 * Shared degraded screen for both scan flows (Préfixer, Découper): a
 * recording exists both at the scan root and inside the `Brut(s)/`
 * subfolder. Both would produce the exact same output name in `processed/`,
 * one silently overwriting the other — so chiro refuses outright rather than
 * picking a winner, and this screen tells her which files are involved.
 */
export const DuplicateNamesScreen = ({
  names,
  onBack,
}: DuplicateNamesScreenProps): React.JSX.Element => {
  useInput((_input, key) => {
    if (key.escape) onBack();
  });

  const visible = names.slice(0, MAX_VISIBLE_NAMES);
  const remaining = names.length - visible.length;

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
      <Text color="yellow">
        {`⚠ ${names.length.toString()} enregistrement${names.length > 1 ? "s existent" : " existe"} aux deux endroits :`}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {visible.map((name) => (
          <Text key={name}>{`  • ${name}`}</Text>
        ))}
        {remaining > 0 ? (
          <Text dimColor>
            {`  ... et ${remaining.toString()} autre${remaining > 1 ? "s" : ""}`}
          </Text>
        ) : null}
      </Box>
      <Box marginTop={1}>
        <Text>
          Ces enregistrements existent aux deux endroits ; gardez-en un seul
          pour éviter que l'un n'écrase l'autre, puis relancez chiro.
        </Text>
      </Box>
      <Footer hints={[{ key: "Échap", label: "retour au menu" }]} />
    </Box>
  );
};
