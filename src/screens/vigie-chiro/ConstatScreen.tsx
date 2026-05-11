import { Box, Text, useInput } from "ink";
import { constants as fsConstants } from "node:fs";
import { access, readdir } from "node:fs/promises";
import { useEffect, useState } from "react";
import { Footer } from "../../components/Footer.js";
import { isAlreadyPrefixed } from "../../lib/vigie-chiro/isAlreadyPrefixed.js";
import type { ConstatCounts } from "../../types.js";

const isWavFile = (name: string): boolean =>
  name.toLowerCase().endsWith(".wav");
const isUpperCaseWavFile = (name: string): boolean => name.endsWith(".WAV");

type ScanState =
  | { kind: "loading" }
  | { kind: "not-readable" }
  | { kind: "not-writable" }
  | { kind: "scan-error"; rawCode: string }
  | { kind: "ready"; counts: ConstatCounts; wavFiles: string[] };

const extractErrorCode = (err: unknown): string => {
  if (
    err instanceof Error &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string"
  ) {
    return (err as { code: string }).code;
  }
  return "UNKNOWN";
};

const scanDirectory = async (cwd: string): Promise<ScanState> => {
  try {
    await access(cwd, fsConstants.R_OK);
  } catch {
    return { kind: "not-readable" };
  }
  try {
    await access(cwd, fsConstants.W_OK);
  } catch {
    return { kind: "not-writable" };
  }

  let entries;
  try {
    entries = await readdir(cwd, { withFileTypes: true });
  } catch (err) {
    return { kind: "scan-error", rawCode: extractErrorCode(err) };
  }

  const wavFiles: string[] = [];
  let alreadyPrefixed = 0;
  let upperCaseWav = 0;
  let otherIgnored = 0;

  for (const dirent of entries) {
    if (!dirent.isFile()) continue;
    if (dirent.name.startsWith(".")) continue;
    if (!isWavFile(dirent.name)) {
      otherIgnored += 1;
      continue;
    }
    wavFiles.push(dirent.name);
    if (isAlreadyPrefixed(dirent.name)) {
      alreadyPrefixed += 1;
    }
    if (isUpperCaseWavFile(dirent.name)) {
      upperCaseWav += 1;
    }
  }

  wavFiles.sort();

  return {
    kind: "ready",
    wavFiles,
    counts: {
      totalWav: wavFiles.length,
      alreadyPrefixed,
      upperCaseWav,
      otherIgnored,
    },
  };
};

export type ConstatScreenProps = {
  cwd: string;
  onContinue: (counts: ConstatCounts, wavFiles: string[]) => void;
  onBack: () => void;
};

export const ConstatScreen = ({
  cwd,
  onContinue,
  onBack,
}: ConstatScreenProps): React.JSX.Element => {
  const [state, setState] = useState<ScanState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    void scanDirectory(cwd).then((result) => {
      if (cancelled) return;
      setState(result);
    });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  const canContinue = state.kind === "ready" && state.counts.totalWav > 0;

  useInput((_input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.return && state.kind === "ready" && canContinue) {
      onContinue(state.counts, state.wavFiles);
    }
  });

  const minimalFooter = [{ key: "Échap", label: "retour au menu" }];
  const nominalFooter = [
    { key: "Entrée", label: "continuer" },
    { key: "Échap", label: "retour au menu" },
  ];

  if (state.kind === "loading") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text dimColor>Analyse du dossier…</Text>
      </Box>
    );
  }

  if (state.kind === "not-readable") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text>📁 {cwd}</Text>
        <Box marginTop={1}>
          <Text color="yellow">⚠ Ce dossier ne peut pas être lu.</Text>
        </Box>
        <Box marginTop={1}>
          <Text>Cela peut arriver si :</Text>
        </Box>
        <Text>
          {"  • vous n'avez pas les permissions (essayez un autre dossier)"}
        </Text>
        <Text>
          {
            "  • le dossier est en cours d'utilisation par une autre application"
          }
        </Text>
        <Footer hints={minimalFooter} />
      </Box>
    );
  }

  if (state.kind === "not-writable") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text>📁 {cwd}</Text>
        <Box marginTop={1}>
          <Text color="yellow">⚠ Ce dossier est protégé en écriture.</Text>
        </Box>
        <Box marginTop={1}>
          <Text>
            L'outil ne peut pas renommer les fichiers ici. Essayez de :
          </Text>
        </Box>
        <Text>{"  • copier les fichiers dans un dossier de votre choix"}</Text>
        <Text>{"  • puis relancer chiro dans ce nouveau dossier"}</Text>
        <Footer hints={minimalFooter} />
      </Box>
    );
  }

  if (state.kind === "scan-error") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text>📁 {cwd}</Text>
        <Box marginTop={1}>
          <Text color="yellow">
            ⚠ Une erreur inattendue est survenue en lisant ce dossier.
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text>
            Détail technique : <Text color="cyan">{state.rawCode}</Text>
          </Text>
          <Text dimColor> (à transmettre si vous demandez de l'aide)</Text>
        </Box>
        <Box marginTop={1}>
          <Text>
            Essayez de fermer les autres applications qui pourraient utiliser ce
            dossier, puis relancez chiro.
          </Text>
        </Box>
        <Footer hints={minimalFooter} />
      </Box>
    );
  }

  // state.kind === "ready"
  const { counts } = state;

  if (counts.totalWav === 0) {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text>📁 {cwd}</Text>
        <Box marginTop={1}>
          <Text>Aucun enregistrement .wav trouvé dans ce dossier.</Text>
        </Box>
        <Box marginTop={1}>
          <Text>
            Vérifiez que vous êtes bien dans le dossier contenant vos fichiers.
          </Text>
          <Text>
            Astuce : dans le Terminal, tapez <Text color="cyan">pwd</Text> pour
            voir où vous êtes, ou <Text color="cyan">ls</Text> pour voir les
            fichiers présents.
          </Text>
        </Box>
        <Footer hints={minimalFooter} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
      <Text>📁 {cwd}</Text>
      <Box marginTop={1}>
        <Text color="green">✓ </Text>
        <Text>
          {counts.totalWav.toString()} enregistrement
          {counts.totalWav > 1 ? "s" : ""} .wav trouvé
          {counts.totalWav > 1 ? "s" : ""} ici
        </Text>
      </Box>
      {counts.alreadyPrefixed > 0 ? (
        <Text>
          {"  • "}
          {counts.alreadyPrefixed.toString()} fichier
          {counts.alreadyPrefixed > 1 ? "s" : ""} déjà au bon format sera
          {counts.alreadyPrefixed > 1 ? "ont" : ""} laissé
          {counts.alreadyPrefixed > 1 ? "s" : ""} tel
          {counts.alreadyPrefixed > 1 ? "s" : ""} quel
          {counts.alreadyPrefixed > 1 ? "s" : ""}
        </Text>
      ) : null}
      {counts.upperCaseWav > 0 ? (
        <Text>
          {"  • "}
          {counts.upperCaseWav.toString()} fichier
          {counts.upperCaseWav > 1 ? "s" : ""} en .WAV ser
          {counts.upperCaseWav > 1 ? "ont" : "a"} renommé
          {counts.upperCaseWav > 1 ? "s" : ""} en .wav (minuscule)
        </Text>
      ) : null}
      {counts.otherIgnored > 0 ? (
        <Text>
          {"  • "}
          {counts.otherIgnored.toString()} autre
          {counts.otherIgnored > 1 ? "s" : ""} fichier
          {counts.otherIgnored > 1 ? "s seront ignorés" : " sera ignoré"} (pas
          des .wav)
        </Text>
      ) : null}
      <Box marginTop={1}>
        <Text>Ce sont bien les fichiers à préparer ?</Text>
      </Box>
      <Footer hints={nominalFooter} />
    </Box>
  );
};
