import { Box, Text, useInput } from "ink";
import { stat } from "node:fs/promises";
import path from "node:path";
import { useEffect, useRef, useState } from "react";
import { Footer } from "../../components/Footer.js";
import type {
  ProcessOptions,
  processWavFiles as ProcessWavFilesType,
} from "../../lib/audio/processWavFiles.js";
import type { ProcessInput, ProcessOutcome } from "../../types.js";

export type ProcessWavFilesFn = typeof ProcessWavFilesType;

const TEENSY_RATE = 38400;
const AUDIOMOTH_OUTPUT_RATE = 25000;

const modeLabel = (mode: ProcessInput["mode"]): string =>
  mode === "preserve"
    ? "Boîtier PaRec (Teensy)"
    : "Autre détecteur (ralentissement 10×)";

const estimateChunkCount = async (
  wavFiles: string[],
  cwd: string,
  mode: ProcessInput["mode"],
): Promise<{ totalChunks: number; totalDurationSec: number }> => {
  // Best-effort estimation based on file size. We assume 16-bit PCM
  // (the format used by Teensy/AudioMoth/SM* in Vigie-Chiro). Files with
  // headers and other framing add a few hundred bytes — negligible at
  // the granularity used in the UI.
  let totalSamples = 0;
  let outputRate = 0;
  for (const name of wavFiles) {
    try {
      const stats = await stat(path.join(cwd, name));
      // Each sample is 2 bytes (16-bit) per channel. We assume mono — the
      // protocol's primary target. If files happen to be stereo we'll
      // overestimate chunks by 2×, which is OK for an approximate preview.
      totalSamples += Math.floor(stats.size / 2);
    } catch {
      // Ignore — best effort.
    }
  }
  // We don't know the source sample rate without reading headers (slow on
  // 149 MB files); approximate based on the chosen mode:
  // - preserve (Teensy): source written at 38 400 Hz, output at 38 400 Hz
  // - expand-10x (AudioMoth typical): source 250 000 Hz, output 25 000 Hz
  //   The total *sample count* in the file is independent of the rate
  //   change (TE is just a header rewrite), so chunks of 5 s @ output
  //   rate of 25 000 Hz means 125 000 samples per chunk.
  outputRate = mode === "preserve" ? TEENSY_RATE : AUDIOMOTH_OUTPUT_RATE;
  const samplesPerChunk = outputRate * 5;
  const totalChunks = Math.ceil(totalSamples / samplesPerChunk);
  const totalDurationSec = totalSamples / outputRate;
  return { totalChunks, totalDurationSec };
};

const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${Math.round(seconds).toString()} secondes`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60)
    return `${minutes.toString()} minute${minutes > 1 ? "s" : ""}`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return `${hours.toString()} h ${remMin.toString().padStart(2, "0")}`;
};

type ConfirmState =
  | { kind: "loading" }
  | {
      kind: "preview";
      totalChunks: number;
      totalDurationSec: number;
    }
  | {
      kind: "running";
      filesTotal: number;
    };

export type ProcessConfirmScreenProps = {
  cwd: string;
  input: ProcessInput;
  wavFiles: string[];
  /** Mutated during the run; consulted by the App-level Ctrl+C handler. */
  runningRef: React.RefObject<boolean>;
  /** Injected for tests. Defaults to the real implementation. */
  processWavFiles: ProcessWavFilesFn;
  onComplete: (outcome: ProcessOutcome) => void;
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

  useEffect(() => {
    let cancelled = false;
    void estimateChunkCount(wavFiles, cwd, input.mode).then((estimate) => {
      if (cancelled) return;
      setState({
        kind: "preview",
        totalChunks: estimate.totalChunks,
        totalDurationSec: estimate.totalDurationSec,
      });
    });
    return () => {
      cancelled = true;
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
    const controller = new AbortController();
    controllerRef.current = controller;
    runningRef.current = true;
    setState({ kind: "running", filesTotal: wavFiles.length });

    const options: ProcessOptions = { signal: controller.signal };
    const outcome = await processWavFiles(wavFiles, cwd, input, options);

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
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text dimColor>
          Découpage en cours… ({state.filesTotal.toString()} fichier
          {state.filesTotal > 1 ? "s" : ""})
        </Text>
        <Box marginTop={1}>
          <Text dimColor>
            Cela peut prendre quelques minutes pour les gros fichiers.
          </Text>
        </Box>
        <Footer hints={[]} />
      </Box>
    );
  }

  // state.kind === "preview"
  return (
    <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
      <Text>📁 {cwd}</Text>
      <Box marginTop={1}>
        <Text>
          {`On va découper ${wavFiles.length.toString()} enregistrement${
            wavFiles.length > 1 ? "s" : ""
          } (environ ${formatDuration(state.totalDurationSec)} d'audio)`}
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
