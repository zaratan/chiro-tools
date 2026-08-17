import type { RcloneAvailability } from "./detectRclone.js";
import type { LoadSettingsResult, OffsiteSettings } from "./settings.js";

export type OffsiteAvailability =
  | { kind: "available"; binPath: string; settings: OffsiteSettings }
  | { kind: "unavailable" };

/**
 * Combines the two boot-time probes (`detectRclone`, `loadOffsiteSettings`)
 * into the single yes/no the menu entry (and the backup Result screen's `A`
 * hint) gate on. Both must succeed — rclone present at a recent-enough
 * version, and a well-formed `settings.json` — or the capability is treated
 * as entirely absent, with no distinction kept between "rclone missing",
 * "rclone too old", and "settings invalid": docs/ux.md is explicit that
 * this degrades in total silence, no message anywhere. A broken remote
 * bucket/config that *is* well-formed JSON surfaces later instead, on the
 * constat screen, once she actually tries to archive (`bucket-missing` /
 * `config-error` from `remoteStat`) — this function only decides whether
 * the door is shown at all.
 */
export const resolveOffsiteAvailability = (
  rclone: RcloneAvailability,
  settingsResult: LoadSettingsResult,
): OffsiteAvailability => {
  if (rclone.kind !== "available") return { kind: "unavailable" };
  if (settingsResult.kind !== "ok") return { kind: "unavailable" };
  return {
    kind: "available",
    binPath: rclone.binPath,
    settings: settingsResult.settings,
  };
};
