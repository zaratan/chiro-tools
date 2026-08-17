import { spawnSync } from "node:child_process";

export type PowerState = "ac" | "battery" | "unknown";

const SPAWN_TIMEOUT_MS = 5000;

const AC_MARKER = "Now drawing from 'AC Power'";
const BATTERY_MARKER = "Now drawing from 'Battery Power'";

/**
 * Reads whether this Mac is on mains power, via `pmset -g batt`.
 *
 * Exists alongside `caffeinate -s` (prefixed onto the rclone command by
 * `buildRcloneCommand`) rather than being redundant with it: `-s` inhibits
 * *system* sleep, but `man caffeinate` states it plainly — "valid only when
 * system is running on AC power". On battery, the strongest inhibition chiro
 * can ask for does nothing, and the confirmation screen's warning sentence
 * becomes the only thing standing between a launch-then-sleep run and a
 * machine that suspends mid-transfer.
 *
 * darwin only, by design (D5/the offsite plan): the target machine is a Mac.
 * `unknown` deliberately triggers no warning of its own — every non-darwin
 * platform, every unrecognised `pmset` output, and every spawn failure
 * degrades to it, and staying silent there is safer than crying wolf on a
 * reading chiro isn't sure about.
 */
export const readPowerState = (): PowerState => {
  if (process.platform !== "darwin") {
    return "unknown";
  }

  let result;
  try {
    result = spawnSync("pmset", ["-g", "batt"], {
      encoding: "utf8",
      timeout: SPAWN_TIMEOUT_MS,
    });
  } catch {
    return "unknown";
  }

  if (result.error || result.status !== 0) {
    return "unknown";
  }

  const output = result.stdout;
  if (output.includes(AC_MARKER)) return "ac";
  if (output.includes(BATTERY_MARKER)) return "battery";
  return "unknown";
};
