import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

// No schemaVersion: any shape change makes readCache return null silently,
// which triggers a fresh fetch + cache rewrite. The cache is never a source
// of truth, only an optimization — silent invalidation is safe.

export type CacheEntry = {
  checkedAt: Date;
  latestTag: string;
};

type RawCacheEntry = {
  checkedAt: string;
  latestTag: string;
};

const isValidRawEntry = (value: unknown): value is RawCacheEntry => {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.checkedAt !== "string") return false;
  if (typeof obj.latestTag !== "string") return false;
  return true;
};

const parseEntry = (raw: unknown): CacheEntry | null => {
  if (!isValidRawEntry(raw)) return null;

  const checkedAt = new Date(raw.checkedAt);
  // Invalid date strings produce NaN from getTime()
  if (isNaN(checkedAt.getTime())) return null;

  return { checkedAt, latestTag: raw.latestTag };
};

/**
 * Reads the update check cache from disk.
 *
 * Returns null if the file is absent, unreadable, contains invalid JSON,
 * or fails schema validation.
 */
export const readCache = async (
  filePath: string,
): Promise<CacheEntry | null> => {
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return null;
  }

  return parseEntry(parsed);
};

/**
 * Writes the update check cache atomically (tmp file + rename).
 *
 * Creates the parent directory if missing. Injectable `now` for testing.
 */
export const writeCache = async (
  filePath: string,
  latestTag: string,
  now: Date = new Date(),
): Promise<void> => {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });

  const entry: RawCacheEntry = {
    checkedAt: now.toISOString(),
    latestTag,
  };

  const tmpPath = filePath + ".tmp";
  await writeFile(tmpPath, JSON.stringify(entry), "utf-8");
  await rename(tmpPath, filePath);
};

/**
 * Returns true when the cached check is still within the TTL window.
 *
 * Pure function — injectable `now` for testing.
 */
export const isCacheFresh = (
  checkedAt: Date,
  ttlMs: number,
  now: Date = new Date(),
): boolean => {
  const ageMs = now.getTime() - checkedAt.getTime();
  return ageMs < ttlMs;
};
