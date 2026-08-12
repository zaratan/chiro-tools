import { Box, Text, useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import { Footer } from "../../components/Footer.js";
import { estimateChunkCount } from "../../lib/audio/estimateChunks.js";
import type {
  ProcessOptions,
  ProcessResult,
  processWavFiles as ProcessWavFilesType,
} from "../../lib/audio/processWavFiles.js";
import { describeError } from "../../lib/errors/describeError.js";
import { formatDuration } from "../../lib/format/duration.js";
import { logSession } from "../../lib/logging/log.js";
import type { ProcessInput, SessionEvent } from "../../types.js";
import { CHIRO_VERSION } from "../../version.js";
import { mapKnownProcessErrorCode } from "./errorMessages.js";
import { RunningView, type RunningViewHandles } from "./RunningView.js";

export type ProcessWavFilesFn = typeof ProcessWavFilesType;

const buildSessionEvent = (
  input: ProcessInput,
  outcome: ProcessResult,
  cwd: string,
): SessionEvent => ({
  schema_version: 2,
  ts: new Date().toISOString(),
  version: CHIRO_VERSION,
  cwd,
  action: "vigie-process",
  input: { mode: input.mode },
  result: {
    processed: outcome.processed.map((p) => ({
      source_file: p.sourceFile,
      chunk_count: p.chunkCount,
      output_sample_rate: p.outputSampleRate,
      channels: p.channels,
    })),
    errored: outcome.errored,
    skipped_too_large: outcome.skippedTooLarge,
    skipped_already_chunked: outcome.skippedAlreadyChunked,
    interrupted: outcome.interrupted,
    duration_ms: outcome.durationMs,
    engine: outcome.engine,
    engine_fallback_count: outcome.engine_fallback_count,
    metadata: outcome.metadata,
  },
});

const metadataEnabled = (): boolean =>
  process.env.CHIRO_DISABLE_METADATA !== "1";

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

type ConfirmState =
  | { kind: "loading" }
  | {
      kind: "preview";
      totalChunks: number;
      totalDurationSec: number;
      totalBytes: number;
    }
  | {
      kind: "running";
      totalChunks: number;
      totalBytes: number;
    }
  | { kind: "run-error"; code: string };

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
  const [state, setState] = useState<ConfirmState>({ kind: "loading" });
  const controllerRef = useRef<AbortController | null>(null);

  // Stable ref to RunningView handles — set once via onMount callback.
  const runningHandlesRef = useRef<RunningViewHandles | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void estimateChunkCount(wavFiles, cwd, input.mode, controller.signal).then(
      (estimate) => {
        if (cancelled) return;
        setState({
          kind: "preview",
          totalChunks: estimate.totalChunks,
          totalDurationSec: estimate.totalDurationSec,
          totalBytes: estimate.totalBytes,
        });
      },
    );
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [cwd, input.mode, wavFiles]);

  useEffect(() => {
    return () => {
      if (controllerRef.current) {
        controllerRef.current.abort();
      }
      runningRef.current = false;
    };
  }, [runningRef]);

  const startProcess = async (): Promise<void> => {
    if (state.kind !== "preview") return;
    const { totalChunks, totalBytes } = state;

    const controller = new AbortController();
    controllerRef.current = controller;
    runningRef.current = true;
    setState({ kind: "running", totalChunks, totalBytes });

    const options: ProcessOptions = {
      signal: controller.signal,
      onProgress: (event) => {
        runningHandlesRef.current?.onProgress(event);
      },
      metadata: {
        enabled: metadataEnabled(),
        chiroVersion: CHIRO_VERSION,
      },
    };

    let outcome: ProcessResult;
    try {
      outcome = await processWavFiles(wavFiles, cwd, input, options);
    } catch (err) {
      runningRef.current = false;
      controllerRef.current = null;
      setState({ kind: "run-error", code: describeError(err) });
      return;
    }

    // Synchronous finalize — forces bar to 100 % before unmount.
    runningHandlesRef.current?.finalizeRender();

    try {
      await logSession(buildSessionEvent(input, outcome, cwd));
    } catch {
      // Local log is best-effort — never block the UI on a write failure.
    }

    runningRef.current = false;
    controllerRef.current = null;
    onComplete(outcome);
  };

  useInput((input2, key) => {
    if (state.kind === "running") {
      if (key.ctrl && input2 === "c") {
        controllerRef.current?.abort();
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
        onMount={(handles) => {
          runningHandlesRef.current = handles;
        }}
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
        <Text>en morceaux de 5 secondes.</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>
          {`Type d'enregistreur choisi : `}
          <Text color="cyan">{modeLabel(input.mode)}</Text>
        </Text>
        <Text>{`Dossier de sortie :          ./processed/`}</Text>
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
