import { isCacheFresh, readCache, writeCache } from "./cache.js";
import { compareVersions } from "./compareVersions.js";
import { UPDATE_CACHE_PATH, UPDATE_CACHE_TTL_MS } from "./constants.js";
import { fetchLatestVersion, type FetchResult } from "./fetchLatestVersion.js";
import { parseVersion } from "./parseVersion.js";

export type CheckResult = { availableVersion: string | null };

export type CheckOptions = {
  currentVersion: string;
  fetcher?: (opts?: { signal?: AbortSignal }) => Promise<FetchResult>;
  cachePath?: string;
  ttlMs?: number;
  now?: Date;
  signal?: AbortSignal;
};

const isRemoteNewer = (remoteTag: string, currentVersion: string): boolean => {
  const remote = parseVersion(remoteTag);
  const current = parseVersion(currentVersion);

  if (remote === null || current === null) return false;

  return compareVersions(remote, current) === 1;
};

/**
 * Orchestrates the update check: cache read → optional network fetch → compare.
 *
 * Design contract:
 * - Never throws. Any unexpected error silently returns `{ availableVersion: null }`.
 * - If currentVersion cannot be parsed, fails silently (no fetch, no cache write).
 * - If the cache is fresh, skips the network entirely.
 * - On a successful fetch, always writes the result to cache.
 */
export const checkForUpdate = async (
  opts: CheckOptions,
): Promise<CheckResult> => {
  const {
    currentVersion,
    fetcher = fetchLatestVersion,
    cachePath = UPDATE_CACHE_PATH,
    ttlMs = UPDATE_CACHE_TTL_MS,
    now,
    signal,
  } = opts;

  try {
    // Validate current version first — silent fail if unparseable
    const parsedCurrent = parseVersion(currentVersion);
    if (parsedCurrent === null) return { availableVersion: null };

    const cachedEntry = await readCache(cachePath);

    if (
      cachedEntry !== null &&
      isCacheFresh(cachedEntry.checkedAt, ttlMs, now)
    ) {
      const available = isRemoteNewer(cachedEntry.latestTag, currentVersion)
        ? cachedEntry.latestTag
        : null;
      return { availableVersion: available };
    }

    // Cache is absent or stale — fetch from network
    const fetchResult = await fetcher({ signal });

    if (fetchResult.kind === "error") return { availableVersion: null };

    await writeCache(cachePath, fetchResult.tagName, now);

    const available = isRemoteNewer(fetchResult.tagName, currentVersion)
      ? fetchResult.tagName
      : null;
    return { availableVersion: available };
  } catch {
    // Unexpected I/O or runtime error — never surface to caller
    return { availableVersion: null };
  }
};
