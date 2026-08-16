import { useEffect, useRef } from "react";
import { ProgressPanel } from "../../components/ProgressPanel.js";
import {
  buildRemainingLabel,
  formatShortDuration,
} from "../../format/progress.js";
import type { VolumeProgressEvent } from "../../lib/archive/createZipVolumes.js";
import {
  ARCHIVED_DIR_DISPLAY,
  type ArchiveEntryStat,
} from "../../lib/archive/planArchive.js";
import { UPLOAD_DIR_DISPLAY } from "../../lib/archive/planUpload.js";
import type { ArchiveFlowMode } from "./useArchiveRun.js";
import type { ArchiveProgressState } from "./useArchiveProgressState.js";
import { useArchiveProgressState } from "./useArchiveProgressState.js";

export type { ArchiveFlowMode };

/**
 * Imperative handles exposed to the parent via the `onMount` callback prop.
 * Same rationale as vigie-process's `RunningView` — Ink has no ref
 * mechanism for sibling-to-sibling communication.
 */
export type RunningViewHandles = {
  onProgress: (event: VolumeProgressEvent) => void;
  finalizeRender: () => void;
};

export type RunningViewProps = {
  /** Wording-only branch — behavior stays identical. */
  mode: ArchiveFlowMode;
  cwd: string;
  entries: readonly ArchiveEntryStat[];
  totalBytes: number;
  onMount: (handles: RunningViewHandles) => void;
};

/**
 * Same shape as the découpage flow's stats line, down to the separator and
 * the "Encore environ" wording — docs/ux.md rejects the "~X" / "≈ X" forms as
 * too notational for the target user, and two flows showing the same
 * information two different ways is its own confusion.
 */
export const buildStatsLine = (
  elapsedMs: number,
  remainingMs: number | null,
  itemsTotal: number,
): string => {
  const base = `Temps écoulé ${formatShortDuration(elapsedMs)}`;
  const remainingLabel = buildRemainingLabel(remainingMs, itemsTotal);
  return remainingLabel === null ? base : `${base} • ${remainingLabel}`;
};

const TITLES: Record<ArchiveFlowMode, string> = {
  backup: "Création du zip en cours…",
  package: "Création des fichiers zip en cours…",
};

/**
 * `Dossier de sortie` differs per mode, and the package flow adds the
 * atomicity reminder here too — it's at T+6 min that she'd go looking in the
 * Finder, not at T=0.
 */
const REASSURANCE_LINES: Record<ArchiveFlowMode, readonly string[]> = {
  backup: [
    "Vos enregistrements ne sont pas modifiés.",
    `Dossier de sortie : ${ARCHIVED_DIR_DISPLAY}`,
    "Vous pouvez laisser cette fenêtre ouverte, ça continue tout seul.",
  ],
  package: [
    "Vos enregistrements ne sont pas modifiés.",
    `Dossier de sortie : ${UPLOAD_DIR_DISPLAY}`,
    "Les fichiers zip n'y apparaîtront qu'à la toute fin, tous ensemble.",
    "Vous pouvez laisser cette fenêtre ouverte, ça continue tout seul.",
  ],
};

/**
 * `Fichier zip N` has no total (unknowable mid-run — the volume count only
 * settles once the batch is fully written, D1) and is masked entirely while
 * still on the first volume: that both keeps a genuine single-volume run
 * (the common one-listening-point case) from ever showing the
 * self-evidently absurd "Fichier zip 1", and starts counting honestly from
 * the second volume on for a real multi-volume run.
 */
export const buildCounterLines = (
  mode: ArchiveFlowMode,
  state: ArchiveProgressState,
): string[] => {
  const lines: string[] = [];
  if (
    mode === "package" &&
    state.volumeIndex !== null &&
    state.volumeIndex > 1
  ) {
    lines.push(`  Fichier zip ${state.volumeIndex.toString()}`);
  }
  if (state.currentEntryIndex !== null) {
    lines.push(
      `  Enregistrement ${(state.currentEntryIndex + 1).toString()} sur ${state.totalEntries.toString()}`,
    );
  }
  return lines;
};

export const RunningView = ({
  mode,
  cwd,
  entries,
  totalBytes,
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
    <ProgressPanel
      cwd={cwd}
      title={TITLES[mode]}
      counterLines={buildCounterLines(mode, state)}
      percent={percent}
      statsLine={buildStatsLine(
        state.elapsedMs,
        state.remainingMs,
        entries.length,
      )}
      reassuranceLines={REASSURANCE_LINES[mode]}
    />
  );
};
