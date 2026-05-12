import { Box, Text, useInput } from "ink";
import { constants as fsConstants } from "node:fs";
import { access, readdir, statfs, stat } from "node:fs/promises";
import path from "node:path";
import { useEffect, useState } from "react";
import { Footer } from "../../components/Footer.js";

const WAV_EXTENSION_REGEX = /\.wav$/i;
const PROCESSED_DIRNAME = "processed";

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

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes.toString()} octets`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} Ko`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(0)} Mo`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} Go`;
};

type ScanState =
  | { kind: "loading" }
  | { kind: "not-readable" }
  | { kind: "not-writable" }
  | { kind: "scan-error"; rawCode: string }
  | { kind: "no-wav" }
  | {
      kind: "processed-conflict";
      conflictCount: number;
    }
  | {
      kind: "insufficient-disk";
      requiredBytes: number;
      availableBytes: number;
    }
  | {
      kind: "ready";
      wavFiles: string[];
      totalInputBytes: number;
    };

const scanProcessed = async (
  processedDir: string,
): Promise<{ exists: boolean; nonTmpCount: number }> => {
  try {
    const entries = await readdir(processedDir);
    const nonTmpCount = entries.filter((e) => !e.endsWith(".tmp")).length;
    return { exists: true, nonTmpCount };
  } catch {
    return { exists: false, nonTmpCount: 0 };
  }
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
  for (const dirent of entries) {
    if (!dirent.isFile()) continue;
    if (dirent.name.startsWith(".")) continue;
    if (WAV_EXTENSION_REGEX.test(dirent.name)) {
      wavFiles.push(dirent.name);
    }
  }
  wavFiles.sort();

  if (wavFiles.length === 0) {
    return { kind: "no-wav" };
  }

  const processedDir = path.join(cwd, PROCESSED_DIRNAME);
  const processedState = await scanProcessed(processedDir);
  if (processedState.exists && processedState.nonTmpCount > 0) {
    return {
      kind: "processed-conflict",
      conflictCount: processedState.nonTmpCount,
    };
  }

  // Tally input bytes for the disk-space pre-check. The output produced is
  // bit-equivalent to the input volume, so we use total input × 1.05 as the
  // safety threshold.
  let totalInputBytes = 0;
  for (const name of wavFiles) {
    try {
      const stats = await stat(path.join(cwd, name));
      totalInputBytes += stats.size;
    } catch {
      // Ignore individual file stat failures — the processor will surface
      // them later as per-file errors.
    }
  }

  try {
    const fsStats = await statfs(cwd);
    const availableBytes = fsStats.bsize * fsStats.bavail;
    const requiredBytes = Math.ceil(totalInputBytes * 1.05);
    if (availableBytes < requiredBytes) {
      return { kind: "insufficient-disk", requiredBytes, availableBytes };
    }
  } catch {
    // statfs failed — proceed; the processor will surface ENOSPC if needed.
  }

  return { kind: "ready", wavFiles, totalInputBytes };
};

export type ProcessConstatScreenProps = {
  cwd: string;
  onContinue: (wavFiles: string[]) => void;
  onBack: () => void;
};

export const ConstatScreen = ({
  cwd,
  onContinue,
  onBack,
}: ProcessConstatScreenProps): React.JSX.Element => {
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

  useInput((_input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.return && state.kind === "ready") {
      onContinue(state.wavFiles);
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
          <Text>L'outil ne peut pas créer le sous-dossier « processed »</Text>
          <Text>
            {"  • copiez les fichiers dans un dossier de votre choix"}
          </Text>
          <Text>{"  • puis relancez chiro dans ce nouveau dossier"}</Text>
        </Box>
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
        <Footer hints={minimalFooter} />
      </Box>
    );
  }

  if (state.kind === "no-wav") {
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
        </Box>
        <Footer hints={minimalFooter} />
      </Box>
    );
  }

  if (state.kind === "processed-conflict") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text>📁 {cwd}</Text>
        <Box marginTop={1}>
          <Text color="yellow">
            ⚠ Un dossier « processed » existe déjà ici.
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text>
            Pour éviter de mélanger les anciens et les nouveaux découpages,
            chiro ne va pas écrire par-dessus. Vous pouvez :
          </Text>
        </Box>
        <Text>
          {"  • renommer l'ancien dossier (par ex. « processed-ancien »)"}
        </Text>
        <Text>{"  • ou le supprimer s'il ne vous sert plus"}</Text>
        <Box marginTop={1}>
          <Text>Puis relancez chiro dans ce dossier.</Text>
        </Box>
        <Footer hints={minimalFooter} />
      </Box>
    );
  }

  if (state.kind === "insufficient-disk") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text>📁 {cwd}</Text>
        <Box marginTop={1}>
          <Text color="yellow">
            ⚠ Pas assez d'espace disque pour cette opération.
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>{`  Espace requis : ~${formatBytes(state.requiredBytes)}`}</Text>
          <Text>{`  Espace dispo  : ${formatBytes(state.availableBytes)}`}</Text>
        </Box>
        <Box marginTop={1}>
          <Text>Libérez de la place puis relancez.</Text>
        </Box>
        <Footer hints={minimalFooter} />
      </Box>
    );
  }

  // state.kind === "ready"
  return (
    <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
      <Text>📁 {cwd}</Text>
      <Box marginTop={1}>
        <Text color="green">✓ </Text>
        <Text>
          {state.wavFiles.length.toString()} enregistrement
          {state.wavFiles.length > 1 ? "s" : ""} .wav prêt
          {state.wavFiles.length > 1 ? "s" : ""} à découper
        </Text>
      </Box>
      <Text>{`  Volume total : ${formatBytes(state.totalInputBytes)}`}</Text>
      <Box marginTop={1}>
        <Text>Ce sont bien les fichiers à découper ?</Text>
      </Box>
      <Footer hints={nominalFooter} />
    </Box>
  );
};
