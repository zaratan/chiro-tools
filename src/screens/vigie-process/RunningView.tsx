import { useEffect, useRef } from "react";
import { ProgressPanel } from "../../components/ProgressPanel.js";
import {
  buildRemainingLabel,
  formatShortDuration,
} from "../../format/progress.js";
import { PROCESSED_DIR_DISPLAY } from "../../lib/audio/batchPlan.js";
import type { ProgressEvent } from "../../types.js";
import { useProgressState } from "./useProgressState.js";

export const buildStatsLine = (
  chunksWritten: number,
  elapsedMs: number,
  remainingMs: number | null,
  filesTotal: number,
): string => {
  const elapsedLabel = formatShortDuration(elapsedMs);
  const base = `${chunksWritten.toString()} fichiers • Temps écoulé ${elapsedLabel}`;
  const remainingLabel = buildRemainingLabel(remainingMs, filesTotal);
  return remainingLabel === null ? base : `${base} • ${remainingLabel}`;
};

/**
 * Imperative handles exposed to the parent via the `onMount` callback prop.
 *
 * Ink has no DOM and no standard `ref` mechanism for sibling-to-sibling
 * communication, so the parent receives `onProgress` and `finalizeRender`
 * via a callback fired in our useEffect. Callbacks come from `useCallback([])`
 * inside the hook — stable for the whole RunningView lifecycle.
 */
export type RunningViewHandles = {
  onProgress: (event: ProgressEvent) => void;
  finalizeRender: () => void;
};

export type RunningViewProps = {
  cwd: string;
  totalFiles: number;
  totalChunksEstimate: number;
  totalBytes: number;
  onMount: (handles: RunningViewHandles) => void;
};

export const RunningView = ({
  cwd,
  totalFiles,
  totalChunksEstimate,
  totalBytes,
  onMount,
}: RunningViewProps): React.JSX.Element => {
  const { state, onProgress, finalizeRender } = useProgressState(
    totalFiles,
    totalChunksEstimate,
    totalBytes,
  );

  // Expose handles to parent once on mount. onProgress and finalizeRender are
  // stable useCallback refs from the hook — safe to capture once at mount.
  const onMountRef = useRef(onMount);
  useEffect(() => {
    onMountRef.current({ onProgress, finalizeRender });
  }, [onProgress, finalizeRender]);

  const percent = Math.min(
    100,
    totalChunksEstimate > 0
      ? Math.round((state.chunksWritten / totalChunksEstimate) * 100)
      : 0,
  );

  const statsLine = buildStatsLine(
    state.chunksWritten,
    state.elapsedMs,
    state.remainingMs,
    totalFiles,
  );

  const counterLines =
    state.currentFileName !== null
      ? [
          `  Fichier ${((state.currentFileIndex ?? 0) + 1).toString()} sur ${totalFiles.toString()}  •  ${state.currentFileName}`,
        ]
      : [];

  return (
    <ProgressPanel
      cwd={cwd}
      title="Découpage en cours…"
      counterLines={counterLines}
      percent={percent}
      statsLine={statsLine}
      reassuranceLines={[
        "Vos fichiers d'origine ne sont pas modifiés.",
        `Dossier de sortie : ${PROCESSED_DIR_DISPLAY}`,
      ]}
    />
  );
};
