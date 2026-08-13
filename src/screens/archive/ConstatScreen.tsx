import { Box, Text, useInput } from "ink";
import { constants as fsConstants } from "node:fs";
import { access, statfs } from "node:fs/promises";
import { useEffect, useState } from "react";
import { Footer } from "../../components/Footer.js";
import {
  buildOutDir,
  PROCESSED_DIR_DISPLAY,
} from "../../lib/audio/batchPlan.js";
import {
  scanProcessedForArchive,
  type ArchiveEntryStat,
} from "../../lib/archive/planArchive.js";
import { formatBytes } from "../../lib/format/bytes.js";

const BYTES_PER_ENTRY_OVERHEAD = 200;
const DISK_SAFETY_MARGIN_BYTES = 1024 * 1024;

type ScanState =
  | { kind: "loading" }
  | { kind: "no-processed" }
  | { kind: "empty-processed" }
  | { kind: "not-writable" }
  | { kind: "scan-error"; rawCode: string }
  | {
      kind: "insufficient-disk";
      requiredBytes: number;
      availableBytes: number;
    }
  | { kind: "ready"; entries: ArchiveEntryStat[]; totalBytes: number };

const isWritable = async (dir: string): Promise<boolean> => {
  try {
    await access(dir, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
};

const scanForArchive = async (
  cwd: string,
  signal: AbortSignal,
): Promise<ScanState> => {
  const processedDir = buildOutDir(cwd);
  const scanResult = await scanProcessedForArchive(processedDir, signal);

  if (scanResult.kind === "no-processed") return { kind: "no-processed" };
  if (scanResult.kind === "empty-processed") {
    return { kind: "empty-processed" };
  }
  if (scanResult.kind === "scan-error") {
    return { kind: "scan-error", rawCode: scanResult.rawCode };
  }
  if (scanResult.kind === "aborted") {
    // Only reachable via unmount abort; the effect's `cancelled` flag
    // already discards this result before it reaches setState.
    return { kind: "loading" };
  }

  const { entries, totalBytes } = scanResult;

  // Writability of cwd (not `processedDir`) — chiro needs to create the
  // `archived/` sibling directory next to `processed/`.
  if (!(await isWritable(cwd))) {
    return { kind: "not-writable" };
  }

  try {
    const fsStats = await statfs(cwd);
    const availableBytes = fsStats.bsize * fsStats.bavail;
    const requiredBytes =
      totalBytes +
      entries.length * BYTES_PER_ENTRY_OVERHEAD +
      DISK_SAFETY_MARGIN_BYTES;
    if (availableBytes < requiredBytes) {
      return { kind: "insufficient-disk", requiredBytes, availableBytes };
    }
  } catch {
    // statfs failed — proceed; createZipArchive will surface ENOSPC if needed.
  }

  return { kind: "ready", entries, totalBytes };
};

export type ArchiveConstatScreenProps = {
  cwd: string;
  onContinue: (entries: ArchiveEntryStat[], totalBytes: number) => void;
  onBack: () => void;
};

export const ConstatScreen = ({
  cwd,
  onContinue,
  onBack,
}: ArchiveConstatScreenProps): React.JSX.Element => {
  const [state, setState] = useState<ScanState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void scanForArchive(cwd, controller.signal).then((result) => {
      if (cancelled) return;
      setState(result);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [cwd]);

  useInput((_input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.return && state.kind === "ready") {
      onContinue(state.entries, state.totalBytes);
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

  if (state.kind === "no-processed") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text>📁 {cwd}</Text>
        <Box marginTop={1}>
          <Text>Aucun dossier « processed » trouvé dans ce dossier.</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>
            Le zip se crée à partir des enregistrements découpés. Lancez d'abord
            « Découper les enregistrements », puis revenez ici.
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>
            Si le découpage est déjà fait, vous n'êtes sans doute pas dans le
            bon dossier. Dans le Terminal, tapez <Text color="cyan">pwd</Text>{" "}
            pour voir où vous êtes.
          </Text>
        </Box>
        <Footer hints={minimalFooter} />
      </Box>
    );
  }

  if (state.kind === "empty-processed") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text>📁 {cwd}</Text>
        <Box marginTop={1}>
          <Text>
            Le dossier « processed » ne contient aucun enregistrement.
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>
            Le découpage s'est peut-être arrêté en route. Relancez « Découper
            les enregistrements », puis revenez ici.
          </Text>
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
        <Box marginTop={1} flexDirection="column">
          <Text>
            L'outil ne peut pas créer le sous-dossier « archived » ici. Essayez
            de :
          </Text>
          <Text>
            {"  • copier les fichiers dans un dossier de votre choix"}
          </Text>
          <Text>{"  • puis relancer chiro dans ce nouveau dossier"}</Text>
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
        <Box marginTop={1} flexDirection="column">
          <Text>
            Détail technique : <Text color="cyan">{state.rawCode}</Text>
          </Text>
          <Text dimColor>{"  (à transmettre si vous demandez de l'aide)"}</Text>
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
        <Box marginTop={1} flexDirection="column">
          <Text>
            Le zip est une copie de vos enregistrements : il peut occuper
            presque autant de place.
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text>Libérez de la place puis réessayez.</Text>
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
          {`${state.entries.length.toString()} enregistrement${
            state.entries.length > 1 ? "s" : ""
          } trouvé${state.entries.length > 1 ? "s" : ""} dans ${PROCESSED_DIR_DISPLAY}`}
        </Text>
      </Box>
      <Text>{`  Volume total : ${formatBytes(state.totalBytes)}`}</Text>
      <Box marginTop={1}>
        <Text>Ce sont bien les enregistrements à mettre dans le zip ?</Text>
      </Box>
      <Footer hints={nominalFooter} />
    </Box>
  );
};
