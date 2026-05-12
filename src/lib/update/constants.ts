import { homedir } from "node:os";
import path from "node:path";

export const GITHUB_REPO = "zaratan/chiro-tools";
export const RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
export const INSTALL_SCRIPT_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/scripts/install.sh`;

/** 15 s — generous for field use in low-signal areas */
export const UPDATE_FETCH_TIMEOUT_MS = 15_000;

/**
 * 6 h — compromise between GitHub anonymous rate limit (60 req/h, so ~3
 * fresh boots/h tolerated across all users sharing the same IP) and perceived
 * freshness for the end user (worst case: notices an update 6 h after release).
 */
export const UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export const UPDATE_CACHE_PATH = path.join(
  homedir(),
  ".chiro",
  "update-check.json",
);
