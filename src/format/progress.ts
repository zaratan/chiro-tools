const BAR_WIDTH = 40;
const ADAPTIVE_MASK_THRESHOLD = 5;

export const renderBar = (percent: number): string => {
  const filled = Math.round((percent / 100) * BAR_WIDTH);
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
};

export const formatShortDuration = (ms: number): string => {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds.toString()} s`;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours.toString()} h ${minutes.toString().padStart(2, "0")} min`;
  }
  if (seconds === 0) return `${minutes.toString()} min`;
  return `${minutes.toString()} min ${seconds.toString().padStart(2, "0")} s`;
};

/**
 * Adaptive masking: hides the ETA for small batches (< 5 items) where the
 * estimate would be too coarse to be meaningful. The whole segment is
 * dropped rather than left as a stale "calcul en cours" message that never
 * resolves — that would be worse than silence.
 */
export const buildRemainingLabel = (
  remainingMs: number | null,
  itemsTotal: number,
): string | null => {
  if (itemsTotal < ADAPTIVE_MASK_THRESHOLD) return null;
  if (remainingMs === null) return "Calcul du temps restant…";
  return `Encore environ ${formatShortDuration(remainingMs)}`;
};
