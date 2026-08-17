import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { chiroHomeDir } from "../chiroHome.js";
import type { SessionEvent } from "../../types.js";

/** Default path for the JSONL session log. */
const DEFAULT_LOG_FILE = path.join(chiroHomeDir(), "sessions.jsonl");

/**
 * Appends a session event as a single JSONL line to the log file.
 *
 * Creates the parent directory if missing.
 * Default log location: `~/.chiro/sessions.jsonl`.
 *
 * @param event The session event to persist.
 * @param logFile Optional override path for testing (default = `~/.chiro/sessions.jsonl`).
 */
export const logSession = async (
  event: SessionEvent,
  logFile: string = DEFAULT_LOG_FILE,
): Promise<void> => {
  await mkdir(path.dirname(logFile), { recursive: true });
  await appendFile(logFile, JSON.stringify(event) + "\n", "utf-8");
};
