import { homedir } from "node:os";
import path from "node:path";

/**
 * `~/.chiro` — chiro's per-user state directory (session log, update-check
 * cache, and `settings.json`). Single source of truth: before this module
 * existed the path was recomputed independently in `logging/log.ts` and
 * `update/constants.ts`, and `offsite/settings.ts` would have made a third.
 */
export const chiroHomeDir = (): string => path.join(homedir(), ".chiro");
