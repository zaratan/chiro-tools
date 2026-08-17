import { Box, Text } from "ink";
import { useEffect, useRef } from "react";
import { Footer } from "../../components/Footer.js";
import { ProgressPanel } from "../../components/ProgressPanel.js";
import { formatBytes } from "../../format/bytes.js";
import { formatShortDuration } from "../../format/progress.js";
import { ARCHIVED_DIR_DISPLAY } from "../../lib/archive/planArchive.js";
import { estimateUploadSeconds } from "../../lib/offsite/estimatedDuration.js";
import type { ChosenArchive } from "../../lib/offsite/pickArchiveToUpload.js";
import { useOffsiteProgressState } from "./useOffsiteProgressState.js";

/**
 * Imperative handles exposed to the parent via the `onMount` callback prop.
 * Same rationale as the archive/vigie-process `RunningView`s — Ink has no
 * ref mechanism for sibling-to-sibling communication.
 */
export type RunningViewHandles = {
  onProgress: (bytesTransferred: number) => void;
  finalizeRender: () => void;
};

export type OffsiteRunningViewProps = {
  cwd: string;
  chosen: ChosenArchive;
  /** Swaps the whole panel for the standalone "Arrêt en cours…" screen — no
   * progress data survives a Ctrl+C escalation worth showing, and a frozen
   * bar next to it would read as a hang. */
  stopping: boolean;
  onMount: (handles: RunningViewHandles) => void;
  /** Test seam, forwarded to `useOffsiteProgressState`. Defaults to the
   * real wall clock — the stall detector is genuinely time-based (D3 of
   * the offsite plan), and a controllable clock is the only way to exercise
   * a 60 s threshold without a 60-real-second test. */
  nowFn?: () => number;
};

const STALLED_NOTICE =
  "⚠ La connexion est ralentie — chiro continue d'essayer.";

const LONG_UPLOAD_THRESHOLD_SECONDS = 30 * 60;

/**
 * Same shape as the other flows' stats line, down to the separator and the
 * "Encore environ" wording (docs/ux.md). Unlike `useArchiveProgressState`'s
 * batch-oriented `buildStatsLine`, there is no item count to gate a "too
 * small a sample" masking on — a single-file transfer's ETA is either
 * knowable (a window exists) or not (too early, or stalled), and both cases
 * already collapse to `remainingMs === null` upstream.
 */
export const buildStatsLine = (
  elapsedMs: number,
  remainingMs: number | null,
  finalizing = false,
): string => {
  const remainingLabel = finalizing
    ? "Finalisation en ligne…"
    : remainingMs === null
      ? "Calcul du temps restant…"
      : `Encore environ ${formatShortDuration(remainingMs)}`;
  return `Temps écoulé ${formatShortDuration(elapsedMs)} • ${remainingLabel}`;
};

/**
 * The "long upload" line is conditional on the *estimated* duration, not a
 * hardcoded "plus d'une heure" — the same running screen serves a 3 GB zip
 * that finishes in 17 minutes and a 15 GB one that runs all night.
 */
export const buildReassuranceLines = (zipBytes: number): string[] => {
  const lines: string[] = [];
  if (estimateUploadSeconds(zipBytes) >= LONG_UPLOAD_THRESHOLD_SECONDS) {
    lines.push("Un archivage long, c'est normal — laissez faire.");
  }
  lines.push(
    "Vous pouvez laisser cette fenêtre ouverte, ça continue tout seul.",
    "Ne rabattez pas l'écran de l'ordinateur.",
    `Votre sauvegarde reste dans ${ARCHIVED_DIR_DISPLAY}, elle n'est pas déplacée.`,
  );
  return lines;
};

export const RunningView = ({
  cwd,
  chosen,
  stopping,
  onMount,
  nowFn,
}: OffsiteRunningViewProps): React.JSX.Element => {
  const { state, onProgress, finalizeRender } = useOffsiteProgressState(
    chosen.size,
    nowFn,
  );

  const onMountRef = useRef(onMount);
  useEffect(() => {
    onMountRef.current({ onProgress, finalizeRender });
  }, [onProgress, finalizeRender]);

  if (stopping) {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text>Arrêt en cours…</Text>
        <Box marginTop={1}>
          <Text dimColor>chiro termine proprement, un instant.</Text>
        </Box>
        <Footer hints={[]} />
      </Box>
    );
  }

  const percent =
    chosen.size > 0
      ? Math.min(100, Math.round((state.bytesTransferred / chosen.size) * 100))
      : 0;

  /**
   * The last bytes leaving is not the end of the run: rclone still has to
   * assemble the multipart upload server-side, and chiro then re-reads the
   * object's size to verify it. Observed on a real 220 MB transfer, that tail
   * held the screen for ~25 s — and it scales with the part count, so a 15 GB
   * archive spends far longer there. Showing a full bar next to "Encore
   * environ 0 s" for minutes is the same failure the Phase 9 "Annulation en
   * cours…" screen exists to prevent: a frozen screen is indistinguishable
   * from a crash. Naming the phase costs one line and removes the doubt.
   */
  const finalizing = chosen.size > 0 && state.bytesTransferred >= chosen.size;

  return (
    <ProgressPanel
      cwd={cwd}
      title="Archivage en ligne en cours…"
      counterLines={[
        `  ${chosen.name}`,
        `  ${formatBytes(state.bytesTransferred)} sur ${formatBytes(chosen.size)}`,
      ]}
      noticeLine={state.stalled ? STALLED_NOTICE : undefined}
      percent={percent}
      statsLine={buildStatsLine(state.elapsedMs, state.remainingMs, finalizing)}
      reassuranceLines={buildReassuranceLines(chosen.size)}
    />
  );
};
