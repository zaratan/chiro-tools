import { readFile } from "node:fs/promises";
import path from "node:path";
import { chiroHomeDir } from "../chiroHome.js";
import { extractErrorCode } from "../fs/safeFsOps.js";

export type OffsiteSettings = {
  remote: string;
  bucket: string;
  prefix: string;
};

export type LoadSettingsResult =
  | { kind: "ok"; settings: OffsiteSettings }
  | { kind: "absent" }
  | { kind: "invalid"; reason: string };

const DEFAULT_SETTINGS_FILE = path.join(chiroHomeDir(), "settings.json");

const isNonEmptyTrimmedString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const stripSlashes = (value: string): string =>
  value.replace(/^\/+/, "").replace(/\/+$/, "");

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

/**
 * Reads and validates `~/.chiro/settings.json`. Never written by chiro
 * itself — it's hand-edited by whoever set up the offsite remote — so
 * every failure mode short of a well-formed `{ coffre: {...} }` object is
 * expected and must resolve to a tagged result, never a throw.
 *
 * `remote` must be a bare rclone remote name, never `remote:bucket` — the
 * `:` check exists because that's the single most likely typo when copying
 * from an `rclone config` transcript. `prefix` is normalized (leading and
 * trailing slashes stripped) so `buildRemoteKey`-style callers can join it
 * with a file name using a single `/` without checking for doubles; an
 * all-slashes prefix normalizes to empty, which is treated as invalid
 * rather than "no prefix" — a silent typo (`"prefix": "/"`) should not
 * quietly turn into "upload straight to the bucket root".
 */
export const loadOffsiteSettings = async (
  filePath: string = DEFAULT_SETTINGS_FILE,
): Promise<LoadSettingsResult> => {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    const code = extractErrorCode(err);
    if (code === "ENOENT") return { kind: "absent" };
    return { kind: "invalid", reason: `cannot read settings file (${code})` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "invalid", reason: "settings file is not valid JSON" };
  }

  const root = asRecord(parsed);
  if (root === null) {
    return { kind: "invalid", reason: "settings file must be a JSON object" };
  }

  const coffre = asRecord(root.coffre);
  if (coffre === null) {
    return { kind: "invalid", reason: '"coffre" must be an object' };
  }

  const { remote, bucket, prefix } = coffre;

  if (!isNonEmptyTrimmedString(remote)) {
    return {
      kind: "invalid",
      reason: "coffre.remote must be a non-empty string",
    };
  }
  const trimmedRemote = remote.trim();
  if (trimmedRemote.includes(":")) {
    return {
      kind: "invalid",
      reason:
        'coffre.remote must not contain ":" (a bare remote name, not "remote:bucket")',
    };
  }

  if (!isNonEmptyTrimmedString(bucket)) {
    return {
      kind: "invalid",
      reason: "coffre.bucket must be a non-empty string",
    };
  }

  if (!isNonEmptyTrimmedString(prefix)) {
    return {
      kind: "invalid",
      reason: "coffre.prefix must be a non-empty string",
    };
  }
  const normalizedPrefix = stripSlashes(prefix.trim());
  if (normalizedPrefix === "") {
    return {
      kind: "invalid",
      reason:
        "coffre.prefix is empty once leading/trailing slashes are removed",
    };
  }

  return {
    kind: "ok",
    settings: {
      remote: trimmedRemote,
      bucket: bucket.trim(),
      prefix: normalizedPrefix,
    },
  };
};
