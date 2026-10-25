import { Box, Text, useInput } from "ink";
import { statfs } from "node:fs/promises";
import { useEffect, useState } from "react";
import { DuplicateNamesScreen } from "../../components/DuplicateNamesScreen.js";
import { Footer } from "../../components/Footer.js";
import {
  buildOutDir,
  buildQueue,
  DEFAULT_MAX_INPUT_BYTES,
} from "../../lib/audio/batchPlan.js";
import {
  detectBatchMode,
  type RecordingRate,
} from "../../lib/audio/detectMode.js";
import { formatBytes } from "../../format/bytes.js";
import { formatScratchFilesIgnored } from "../../format/scratchFiles.js";
import { describeScanOrigin } from "../../format/scanOrigin.js";
import { fitPath } from "../../format/path.js";
import {
  checkProcessedDirConflict,
  scanDirectory as scanWavDirectory,
  sumFileSizes,
} from "../../lib/fs/scanDirectory.js";
import type { ProcessInput, TimeExpansionMode } from "../../types.js";
import { MixedRecordersView, UnclassifiableView } from "./ModeRefusalViews.js";

type ScanState =
  | { kind: "loading" }
  | { kind: "not-readable" }
  | { kind: "not-writable" }
  | { kind: "scan-error"; rawCode: string }
  | { kind: "duplicate-names"; names: string[] }
  | { kind: "no-wav"; scratchCount: number }
  | {
      kind: "mixed-recorders";
      preserve: RecordingRate[];
      expand: RecordingRate[];
    }
  | { kind: "unclassifiable"; files: RecordingRate[]; everyFile: boolean }
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
      subDirName: string | null;
      rootCount: number;
      subCount: number;
      scratchCount: number;
      mode: TimeExpansionMode;
    };

const scanDirectory = async (
  cwd: string,
  signal: AbortSignal,
): Promise<ScanState> => {
  const scanResult = await scanWavDirectory(cwd);
  if (scanResult.kind !== "ok") {
    return scanResult;
  }

  const { wavFiles, subDirName, rootCount, subCount } = scanResult;
  const scratchCount = scanResult.scratchFiles.length;
  if (wavFiles.length === 0) {
    return { kind: "no-wav", scratchCount };
  }

  const processedState = await checkProcessedDirConflict(buildOutDir(cwd));
  if (processedState.exists && processedState.nonTmpCount > 0) {
    return {
      kind: "processed-conflict",
      conflictCount: processedState.nonTmpCount,
    };
  }

  const { queue } = await buildQueue(
    wavFiles,
    cwd,
    DEFAULT_MAX_INPUT_BYTES,
    signal,
  );
  if (signal.aborted) return { kind: "loading" };
  const detection = detectBatchMode(queue);
  if (detection.kind === "mixed") {
    return {
      kind: "mixed-recorders",
      preserve: detection.preserve,
      expand: detection.expand,
    };
  }
  if (detection.kind === "unclassifiable") {
    return {
      kind: "unclassifiable",
      files: detection.files,
      everyFile: detection.files.length === queue.length,
    };
  }
  const mode = detection.kind === "ok" ? detection.mode : "preserve";

  // Tally input bytes for the disk-space pre-check. The output produced is
  // bit-equivalent to the input volume, so we use total input × 1.05 as the
  // safety threshold.
  const sumResult = await sumFileSizes(cwd, wavFiles, signal);
  if (sumResult.kind === "aborted") {
    // Only reachable via unmount abort; the effect's `cancelled` flag
    // already discards this result before it reaches setState.
    return { kind: "loading" };
  }
  const { totalBytes: totalInputBytes } = sumResult;

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

  return {
    kind: "ready",
    wavFiles,
    totalInputBytes,
    subDirName,
    rootCount,
    subCount,
    scratchCount,
    mode,
  };
};

export type ProcessConstatScreenProps = {
  cwd: string;
  onContinue: (wavFiles: string[], input: ProcessInput) => void;
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
    const controller = new AbortController();
    void scanDirectory(cwd, controller.signal).then((result) => {
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
      onContinue(state.wavFiles, { mode: state.mode });
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
        <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
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
        <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
        <Box marginTop={1}>
          <Text color="yellow">⚠ Ce dossier est protégé en écriture.</Text>
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Text>
            L'outil ne peut pas créer le sous-dossier « processed » ici. Essayez
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

  if (state.kind === "duplicate-names") {
    return <DuplicateNamesScreen names={state.names} onBack={onBack} />;
  }

  if (state.kind === "no-wav") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Aucun enregistrement .wav trouvé dans ce dossier.</Text>
          {state.scratchCount > 0 ? (
            <Text dimColor>
              {`  ${formatScratchFilesIgnored(state.scratchCount)}`}
            </Text>
          ) : null}
        </Box>
        <Box marginTop={1} flexDirection="column">
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

  if (state.kind === "mixed-recorders") {
    return (
      <MixedRecordersView
        cwd={cwd}
        preserve={state.preserve}
        expand={state.expand}
      />
    );
  }

  if (state.kind === "unclassifiable") {
    return (
      <UnclassifiableView
        cwd={cwd}
        files={state.files}
        everyFile={state.everyFile}
      />
    );
  }

  if (state.kind === "processed-conflict") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
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
        <Box marginTop={1}>
          <Text>Libérez de la place puis relancez.</Text>
        </Box>
        <Footer hints={minimalFooter} />
      </Box>
    );
  }

  // state.kind === "ready"
  const origin = describeScanOrigin(
    state.subDirName,
    state.rootCount,
    state.subCount,
  );

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
      <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
      <Box marginTop={1}>
        <Text color="green">✓ </Text>
        <Text>
          {state.wavFiles.length.toString()} enregistrement
          {state.wavFiles.length > 1 ? "s" : ""} .wav prêt
          {state.wavFiles.length > 1 ? "s" : ""} à découper
        </Text>
      </Box>
      <Text>{`  Volume total : ${formatBytes(state.totalInputBytes)}`}</Text>
      {origin !== null ? (
        <Text dimColor>
          {origin.kind === "all-sub"
            ? `  (trouvés dans ${origin.label})`
            : `  (${origin.rootCount.toString()} ici et ${origin.subCount.toString()} dans ${origin.label})`}
        </Text>
      ) : null}
      {state.scratchCount > 0 ? (
        <Text
          dimColor
        >{`  ${formatScratchFilesIgnored(state.scratchCount)}`}</Text>
      ) : null}
      <Box marginTop={1}>
        <Text>Ce sont bien les fichiers à découper ?</Text>
      </Box>
      <Footer hints={nominalFooter} />
    </Box>
  );
};
