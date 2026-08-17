import { statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * Whether the rclone offsite-archive capability is usable on this machine.
 *
 * Synchronous and called once at boot, mirroring `detectSox`: a `useEffect`
 * probe would let `MenuScreen` render without the offsite entry and then gain
 * it 100-300 ms later, opening a window where a focused index silently points
 * at the wrong item (the exact race documented for sox in Phase 9). Run
 * before `render()` instead, the race disappears by construction.
 *
 * Does **no network call** — `rclone version` never touches the remote — so
 * a captive portal cannot freeze the TUI before its first frame the way an
 * `rclone lsd` would.
 */
export type RcloneAvailability =
  | { kind: "available"; binPath: string; version: string }
  | { kind: "absent" }
  | { kind: "too-old"; binPath: string; version: string };

// `lsjson --stat`, the only call `remoteStat` makes, was added in this
// release — below it, offsite archiving cannot work at all.
const MIN_VERSION: readonly [number, number, number] = [1, 53, 0];

// Unlike `detectSox`, this probe passes an explicit timeout to `spawnSync`:
// a hung `rclone version` (broken FUSE mount on the remote's config path,
// for instance) must not stall boot indefinitely.
const SPAWN_TIMEOUT_MS = 5000;

const which = (name: string): string | null => {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      const st = statSync(candidate);
      if (st.isFile() && (st.mode & 0o111) !== 0) return candidate;
    } catch {
      // does not exist or no access — try next PATH entry
    }
  }
  return null;
};

type ParsedVersion = readonly [number, number, number];

const parseVersionLine = (firstLine: string): ParsedVersion | null => {
  const match = /^rclone\s+v(\d+)\.(\d+)\.(\d+)/.exec(firstLine.trim());
  if (!match) return null;
  const [, major, minor, patch] = match;
  if (major === undefined || minor === undefined || patch === undefined) {
    return null;
  }
  return [Number(major), Number(minor), Number(patch)];
};

const isAtLeast = (version: ParsedVersion, min: ParsedVersion): boolean => {
  for (let i = 0; i < 3; i++) {
    const v = version[i] ?? 0;
    const m = min[i] ?? 0;
    if (v > m) return true;
    if (v < m) return false;
  }
  return true;
};

export const detectRclone = (): RcloneAvailability => {
  if (process.env.CHIRO_DISABLE_OFFSITE) {
    return { kind: "absent" };
  }

  const binPath = which("rclone");
  if (binPath === null) {
    return { kind: "absent" };
  }

  let result;
  try {
    result = spawnSync(binPath, ["version"], {
      encoding: "utf8",
      timeout: SPAWN_TIMEOUT_MS,
    });
  } catch {
    return { kind: "absent" };
  }

  if (result.error || result.status !== 0) {
    return { kind: "absent" };
  }

  const firstLine = result.stdout.split("\n")[0] ?? "";
  const parsed = parseVersionLine(firstLine);
  // An unparsable version string is treated as absent rather than assumed
  // recent enough — no line here supposes anything it hasn't measured.
  if (parsed === null) {
    return { kind: "absent" };
  }

  const version = `${String(parsed[0])}.${String(parsed[1])}.${String(parsed[2])}`;

  if (!isAtLeast(parsed, MIN_VERSION)) {
    return { kind: "too-old", binPath, version };
  }

  return { kind: "available", binPath, version };
};
