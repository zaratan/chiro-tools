import { Box, Text } from "ink";
import { Footer } from "../../components/Footer.js";
import { fitPath } from "../../format/path.js";
import type { RecordingRate } from "../../lib/audio/detectMode.js";

const MAX_VISIBLE_NAMES = 4;
const backToMenu = [{ key: "Échap", label: "retour au menu" }];

const FamilyLine = ({
  label,
  files,
}: {
  label: string;
  files: readonly RecordingRate[];
}): React.JSX.Element => (
  <Box flexDirection="column">
    <Text>{`  • ${files.length.toString()} ${label}`}</Text>
    {files[0] !== undefined ? (
      <Box marginLeft={6}>
        <Text dimColor>{`par ex. ${files[0].file}`}</Text>
      </Box>
    ) : null}
  </Box>
);

export const MixedRecordersView = ({
  cwd,
  preserve,
  expand,
}: {
  cwd: string;
  preserve: readonly RecordingRate[];
  expand: readonly RecordingRate[];
}): React.JSX.Element => (
  <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
    <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
    <Box marginTop={1}>
      <Text color="yellow">
        ⚠ Ce dossier mélange deux sortes d'enregistrements :
      </Text>
    </Box>
    <Box marginTop={1} flexDirection="column">
      <FamilyLine
        label={`déjà ralenti${preserve.length > 1 ? "s" : ""} 10× à l'enregistrement`}
        files={preserve}
      />
      <FamilyLine label="à ralentir 10×" files={expand} />
    </Box>
    <Box marginTop={1}>
      <Text>
        chiro ne peut pas découper les deux ensemble. Rangez chaque sorte dans
        son propre dossier, puis relancez chiro dans chacun.
      </Text>
    </Box>
    <Footer hints={backToMenu} />
  </Box>
);

export const UnclassifiableView = ({
  cwd,
  files,
  everyFile,
}: {
  cwd: string;
  files: readonly RecordingRate[];
  everyFile: boolean;
}): React.JSX.Element => {
  const plural = files.length > 1;
  const visible = files.slice(0, MAX_VISIBLE_NAMES);
  const remaining = files.length - visible.length;
  const rates = [...new Set(files.map((f) => f.sampleRate))];
  const title = everyFile
    ? plural
      ? "⚠ chiro ne sait pas découper les enregistrements de ce dossier :"
      : "⚠ chiro ne sait pas découper l'enregistrement de ce dossier :"
    : `⚠ chiro ne sait pas découper ${files.length.toString()} enregistrement${plural ? "s" : ""} de ce dossier :`;

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
      <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
      <Box marginTop={1}>
        <Text color="yellow">{title}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {visible.map((f) => (
          <Box key={f.file} marginLeft={2}>
            <Text>{`• ${f.file}`}</Text>
          </Box>
        ))}
        {remaining > 0 ? (
          <Text dimColor>
            {`  ... et ${remaining.toString()} autre${remaining > 1 ? "s" : ""}`}
          </Text>
        ) : null}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>
          {`chiro ne reconnaît pas l'enregistreur qui ${plural ? "les a produits" : "l'a produit"}.`}
        </Text>
        {everyFile ? null : (
          <Text>
            {`Déplacez-${plural ? "les" : "le"} dans un autre dossier, puis relancez chiro pour découper les autres.`}
          </Text>
        )}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>
          Détail technique :{" "}
          <Text color="cyan">{`fréquence ${rates.map((r) => `${r.toString()} Hz`).join(", ")}`}</Text>
        </Text>
        <Text dimColor>{"  (à transmettre si vous demandez de l'aide)"}</Text>
      </Box>
      <Footer hints={backToMenu} />
    </Box>
  );
};
