import { Box, Text } from "ink";
import { useEffect, useRef } from "react";
import { Footer } from "../../components/Footer.js";
import type { ArchiveProgressEvent } from "../../lib/archive/createZipArchive.js";
import type { ArchiveEntryStat } from "../../lib/archive/planArchive.js";
import { formatShortDuration, renderBar } from "../../lib/format/progress.js";
import { useArchiveProgressState } from "./useArchiveProgressState.js";

/**
 * Imperative handles exposed to the parent via the `onMount` callback prop.
 * Same rationale as vigie-process's `RunningView` — Ink has no ref
 * mechanism for sibling-to-sibling communication.
 */
export type RunningViewHandles = {
  onProgress: (event: ArchiveProgressEvent) => void;
  finalizeRender: () => void;
};

export type RunningViewProps = {
  cwd: string;
  entries: readonly ArchiveEntryStat[];
  totalBytes: number;
  /** e.g. "./archived/processed_202608121430.zip" — the resolved name,
   * known once the run has actually started. */
  zipDisplayPath: string;
  onMount: (handles: RunningViewHandles) => void;
};

/**
 * "Temps écoulé X   Temps restant ~Y" — the zip flow's own composed stats
 * line, wording validated separately from the découpage flow's ("Encore
 * environ Y" via `buildRemainingLabel`), even though both reuse the same
 * `formatShortDuration` primitive.
 */
export const buildStatsLine = (
  elapsedMs: number,
  remainingMs: number | null,
): string => {
  const elapsedLabel = `Temps écoulé ${formatShortDuration(elapsedMs)}`;
  const remainingLabel =
    remainingMs === null
      ? "Calcul du temps restant…"
      : `Temps restant ~${formatShortDuration(remainingMs)}`;
  return `${elapsedLabel}   ${remainingLabel}`;
};

export const RunningView = ({
  cwd,
  entries,
  totalBytes,
  zipDisplayPath,
  onMount,
}: RunningViewProps): React.JSX.Element => {
  const { state, onProgress, finalizeRender } = useArchiveProgressState(
    entries,
    totalBytes,
  );

  const onMountRef = useRef(onMount);
  useEffect(() => {
    onMountRef.current({ onProgress, finalizeRender });
  }, [onProgress, finalizeRender]);

  const percent =
    totalBytes > 0
      ? Math.min(100, Math.round((state.bytesRead / totalBytes) * 100))
      : 0;

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
      <Text>📁 {cwd}</Text>
      <Box marginTop={1}>
        <Text>Création du zip en cours…</Text>
      </Box>
      {state.currentEntryIndex !== null ? (
        <Box marginTop={1}>
          <Text>
            {`  Enregistrement ${(state.currentEntryIndex + 1).toString()} sur ${state.totalEntries.toString()}`}
          </Text>
        </Box>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        <Text>{`  ${renderBar(percent)}  ${percent.toString()} %`}</Text>
        <Text dimColor>
          {`  ${buildStatsLine(state.elapsedMs, state.remainingMs)}`}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>Vos enregistrements ne sont pas modifiés.</Text>
        <Text dimColor>{`Fichier créé : ${zipDisplayPath}`}</Text>
      </Box>
      <Footer hints={[]} />
    </Box>
  );
};
