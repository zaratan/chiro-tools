import { Box, Text, useInput } from "ink";
import { Footer } from "../../components/Footer.js";
import { PROCESSED_DIR_DISPLAY } from "../../lib/audio/batchPlan.js";
import type { ProcessResult } from "../../lib/audio/processWavFiles.js";
import { formatDuration } from "../../lib/format/duration.js";
import type { ProcessInput } from "../../types.js";
import { mapKnownProcessErrorCode } from "./errorMessages.js";
import { RunningView } from "./RunningView.js";
import {
  useVigieProcessRun,
  type ProcessWavFilesFn,
} from "./useVigieProcessRun.js";

export type { ProcessWavFilesFn };

const modeLabel = (mode: ProcessInput["mode"]): string =>
  mode === "preserve"
    ? "Boîtier PaRec (Teensy)"
    : "Autre détecteur (ralentissement 10×)";

/**
 * Capitalizes the first letter and appends a trailing period — the mapper
 * wordings are calibrated lowercase for use as bullet points elsewhere.
 * "chiro" stays lowercase even sentence-initial (brand name convention,
 * cf. docs/ux.md — never capitalized, not even at the start of a sentence).
 */
const asSentence = (text: string): string => {
  if (text.startsWith("chiro")) return `${text}.`;
  const [first, ...rest] = text;
  if (first === undefined) return text;
  return `${first.toUpperCase()}${rest.join("")}.`;
};

export type ProcessConfirmScreenProps = {
  cwd: string;
  input: ProcessInput;
  wavFiles: string[];
  /** Mutated during the run; consulted by the App-level Ctrl+C handler. */
  runningRef: React.RefObject<boolean>;
  /** Injected for tests. Defaults to the real implementation. */
  processWavFiles: ProcessWavFilesFn;
  onComplete: (outcome: ProcessResult) => void;
  onBack: () => void;
};

export const ConfirmScreen = ({
  cwd,
  input,
  wavFiles,
  runningRef,
  processWavFiles,
  onComplete,
  onBack,
}: ProcessConfirmScreenProps): React.JSX.Element => {
  const { state, startProcess, abort, registerRunningViewHandles } =
    useVigieProcessRun({
      cwd,
      input,
      wavFiles,
      runningRef,
      processWavFiles,
      onComplete,
    });

  useInput((input2, key) => {
    if (state.kind === "running") {
      if (key.ctrl && input2 === "c") {
        abort();
      }
      return;
    }
    if (state.kind === "loading") {
      if (key.escape) onBack();
      return;
    }
    if (key.escape) {
      onBack();
      return;
    }
    if (key.return) {
      void startProcess();
    }
  });

  if (state.kind === "loading") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text dimColor>Estimation…</Text>
      </Box>
    );
  }

  if (state.kind === "running") {
    return (
      <RunningView
        cwd={cwd}
        totalFiles={wavFiles.length}
        totalChunksEstimate={state.totalChunks}
        totalBytes={state.totalBytes}
        onMount={registerRunningViewHandles}
      />
    );
  }

  if (state.kind === "run-error") {
    const knownMessage = mapKnownProcessErrorCode(state.code);
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text>📁 {cwd}</Text>
        <Box marginTop={1}>
          <Text color="yellow">
            ⚠ Une erreur est survenue pendant le découpage.
          </Text>
        </Box>
        {knownMessage !== null ? (
          <Box marginTop={1}>
            <Text>{asSentence(knownMessage)}</Text>
          </Box>
        ) : null}
        <Box marginTop={1} flexDirection="column">
          <Text>
            Détail technique : <Text color="cyan">{state.code}</Text>
          </Text>
          <Text dimColor>{"  (à transmettre si vous demandez de l'aide)"}</Text>
        </Box>
        <Footer hints={[{ key: "Échap", label: "revenir au début" }]} />
      </Box>
    );
  }

  // state.kind === "preview"
  return (
    <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
      <Text>📁 {cwd}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          {`On va découper ${wavFiles.length.toString()} enregistrement${
            wavFiles.length > 1 ? "s" : ""
          } (environ ${formatDuration(state.totalDurationSec)} d'audio${
            input.mode === "expand-10x" ? " une fois étendu" : ""
          })`}
        </Text>
        <Text>en fichiers de 5 secondes.</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>
          {`Type d'enregistreur choisi : `}
          <Text color="cyan">{modeLabel(input.mode)}</Text>
        </Text>
        <Text>{`Dossier de sortie :          ${PROCESSED_DIR_DISPLAY}`}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Vos fichiers d'origine ne seront pas modifiés.</Text>
      </Box>
      <Footer
        hints={[
          { key: "Entrée", label: "découper" },
          { key: "Échap", label: "modifier la saisie" },
        ]}
      />
    </Box>
  );
};
