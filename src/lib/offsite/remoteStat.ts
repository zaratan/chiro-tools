import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import type { OffsiteSettings } from "./settings.js";

export type RemoteStatResult =
  | { kind: "present"; bytes: number; modTime: string; tier: string | null }
  | { kind: "absent" }
  | { kind: "bucket-missing" }
  | { kind: "config-error" }
  | { kind: "aborted" }
  | { kind: "error"; code: string };

export type RemoteStatDeps = {
  binPath: string;
};

export type RemoteStatParams = {
  settings: OffsiteSettings;
  key: string;
  signal?: AbortSignal;
};

/** `<remote>:<bucket>/<prefix>/<key>` — shared with `uploadArchive`, which
 * writes to this exact path and must verify against this exact path. */
export const buildRemoteObjectPath = (
  settings: OffsiteSettings,
  key: string,
): string => `${settings.remote}:${settings.bucket}/${settings.prefix}/${key}`;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

/**
 * Interrogates the vault for one key. The sole source of truth for "already
 * online" — nothing in this flow ever reads `sessions.jsonl` back (see
 * `docs/architecture.md` § offsite: a journal key was found not to be
 * unique across two studies processed the same day).
 *
 * `--retries 1 --low-level-retries 1 --contimeout 10s --timeout 30s`: without
 * these, rclone's defaults (`--retries 3 --low-level-retries 10`) can block
 * the screen for several minutes on a dead network — and while an operation
 * is running the global Ctrl+C handler is swallowed, so there would be no
 * way out. The signal below is the only escape hatch, and the kill it does
 * is a hard one (`SIGKILL`, no grace period): unlike `uploadArchive`, a
 * `lsjson --stat` has no multipart state to let unwind cleanly.
 *
 * **The discriminant is `IsDir`, never the exit code.** Measured on the real
 * bucket, 2026-08-17, rclone v1.75.0:
 *
 * | case              | exit | body                                          |
 * | ----------------- | ---- | --------------------------------------------- |
 * | present            | 0    | `{"IsDir": false, "Size": N, "Tier": "..."}`   |
 * | **absent**         | **0**| `{"IsDir": true, "Size": -1}` — a pseudo-dir   |
 * | bucket missing     | 3    | `Failed to lsjson: directory not found`        |
 * | remote unknown     | 1    | `didn't find section in config file`           |
 *
 * An absent object exits **successfully** as a pseudo-directory of size -1.
 * Reading `Size` on a plain exit-0 check would report "present, size -1" —
 * the single most dangerous misread this module could make, and it sits on
 * the nominal path (every first-ever archive of a study hits it).
 */
export const remoteStat = async (
  deps: RemoteStatDeps,
  params: RemoteStatParams,
): Promise<RemoteStatResult> => {
  const { settings, key, signal } = params;

  if (signal?.aborted === true) {
    return { kind: "aborted" };
  }

  const target = buildRemoteObjectPath(settings, key);
  const args = [
    "lsjson",
    "--stat",
    target,
    "--retries",
    "1",
    "--low-level-retries",
    "1",
    "--contimeout",
    "10s",
    "--timeout",
    "30s",
  ];

  return new Promise<RemoteStatResult>((resolve) => {
    let child: ChildProcess;
    try {
      child = nodeSpawn(deps.binPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolve({ kind: "error", code: "rclone-spawn-failed" });
      return;
    }

    let settled = false;
    let aborted = false;
    let stdout = "";

    const finish = (result: RemoteStatResult): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };

    const onAbort = (): void => {
      aborted = true;
      child.kill("SIGKILL");
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.on("error", () => {
      finish({ kind: "error", code: "rclone-spawn-failed" });
    });

    child.on("close", (code) => {
      if (aborted) {
        finish({ kind: "aborted" });
        return;
      }

      if (code === 0) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          finish({ kind: "error", code: "unparseable-lsjson" });
          return;
        }
        const record = asRecord(parsed);
        if (record === null) {
          finish({ kind: "error", code: "unparseable-lsjson" });
          return;
        }
        if (record.IsDir === true) {
          finish({ kind: "absent" });
          return;
        }
        if (record.IsDir === false) {
          const size = record.Size;
          const modTime = record.ModTime;
          if (typeof size !== "number" || typeof modTime !== "string") {
            finish({ kind: "error", code: "unparseable-lsjson" });
            return;
          }
          const tier = typeof record.Tier === "string" ? record.Tier : null;
          finish({ kind: "present", bytes: size, modTime, tier });
          return;
        }
        finish({ kind: "error", code: "unparseable-lsjson" });
        return;
      }

      if (code === 3) {
        finish({ kind: "bucket-missing" });
        return;
      }
      if (code === 1) {
        finish({ kind: "config-error" });
        return;
      }
      finish({
        kind: "error",
        code: `rclone-exit:${String(code ?? "signal")}`,
      });
    });
  });
};
