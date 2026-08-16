import { statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * Whether the sox fast-path is usable on this machine.
 *
 * Lives apart from `soxFastPath.ts` on purpose: this is a **capability
 * probe**, run once at boot from `app.tsx`, while everything in that module
 * runs per batch. Two lifecycles, two callers, two reasons to change.
 */
export type SoxAvailability =
  { kind: "available"; binPath: string } | { kind: "absent" };

// Spot-check: compare this many samples from the middle of each verified chunk

// Resolves the full path of a binary by searching PATH entries.
// Uses statSync to check file existence without spawning a subprocess,
// so it works even when PATH is restricted to a custom directory in tests.
const which = (name: string): string | null => {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      const st = statSync(candidate);
      // Check that the file is executable (owner, group, or other exec bit)
      if (st.isFile() && (st.mode & 0o111) !== 0) return candidate;
    } catch {
      // file does not exist or no access — try next
    }
  }
  return null;
};

export const detectSox = (): Promise<SoxAvailability> => {
  if (process.env.CHIRO_DISABLE_FASTPATH) {
    return Promise.resolve({ kind: "absent" });
  }

  const binPath = which("sox");
  if (binPath === null) {
    return Promise.resolve({ kind: "absent" });
  }

  try {
    const result = spawnSync(binPath, ["--version"], { encoding: "utf8" });
    if (result.status !== 0) {
      return Promise.resolve({ kind: "absent" });
    }
  } catch {
    return Promise.resolve({ kind: "absent" });
  }

  return Promise.resolve({ kind: "available", binPath });
};
