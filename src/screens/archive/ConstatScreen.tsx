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
import { buildUploadDir } from "../../lib/archive/planUpload.js";
import { cleanOrphanStagingDirs } from "../../lib/archive/createZipVolumes.js";
import { formatBytes } from "../../format/bytes.js";
import type { ArchiveFlowMode } from "./useArchiveRun.js";
import { fitPath } from "../../format/path.js";

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

const DIR_LABEL: Record<ArchiveFlowMode, string> = {
  backup: "archived",
  package: "upload",
};

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
  mode: ArchiveFlowMode,
  signal: AbortSignal,
): Promise<ScanState> => {
  const processedDir = buildOutDir(cwd);

  // Best-effort, silent — the screen already reads "Analyse du dossier…",
  // and this is unrelated to whether `processed/` scans cleanly, so it runs
  // regardless of that outcome.
  const orphanCleanup =
    mode === "package"
      ? cleanOrphanStagingDirs(buildUploadDir(cwd)).catch(() => undefined)
      : Promise.resolve();

  const [scanResult] = await Promise.all([
    scanProcessedForArchive(processedDir, signal),
    orphanCleanup,
  ]);

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
  // `archived`/`upload` sibling directory next to `processed/`.
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
    // statfs failed — proceed; the run will surface ENOSPC if needed.
  }

  return { kind: "ready", entries, totalBytes };
};

export type ArchiveConstatScreenProps = {
  /** Wording-only branch: the target-folder label and the
   * closing question differ; the scan itself does not. */
  mode: ArchiveFlowMode;
  cwd: string;
  onContinue: (entries: ArchiveEntryStat[], totalBytes: number) => void;
  onBack: () => void;
};

export const ConstatScreen = ({
  mode,
  cwd,
  onContinue,
  onBack,
}: ArchiveConstatScreenProps): React.JSX.Element => {
  const [state, setState] = useState<ScanState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void scanForArchive(cwd, mode, controller.signal).then((result) => {
      if (cancelled) return;
      setState(result);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [cwd, mode]);

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

  const dirLabel = DIR_LABEL[mode];

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
        <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
        <Box marginTop={1}>
          <Text>Aucun dossier « processed » trouvé dans ce dossier.</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>
            {mode === "backup"
              ? "Le zip se crée à partir des enregistrements découpés. Lancez d'abord « Découper les enregistrements », puis revenez ici."
              : "Les fichiers zip se créent à partir des enregistrements découpés. Lancez d'abord « Découper les enregistrements », puis revenez ici."}
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
        <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
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
        <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
        <Box marginTop={1}>
          <Text color="yellow">⚠ Ce dossier est protégé en écriture.</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>
            {`L'outil ne peut pas créer le sous-dossier « ${dirLabel} » ici. Essayez de :`}
          </Text>
          <Text>
            {
              "  • copier le dossier « processed » dans un dossier où vous pouvez écrire"
            }
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
        <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
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
        <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
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
            {mode === "backup"
              ? "Le zip est une copie de vos enregistrements : il peut occuper presque autant de place."
              : "Les fichiers zip sont une copie de vos enregistrements : ils peuvent occuper presque autant de place."}
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
      <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
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
        <Text>
          {mode === "backup"
            ? "Ce sont bien les enregistrements à mettre dans le zip ?"
            : "Ce sont bien les enregistrements à déposer sur Vigie-Chiro ?"}
        </Text>
      </Box>
      <Footer hints={nominalFooter} />
    </Box>
  );
};
