import { existsSync, readFileSync } from "node:fs";
import {
  chmod,
  mkdtemp,
  rm,
  writeFile as writeFileAsync,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  nodeRcloneSpawn,
  uploadArchive,
  type RemoteStatFn,
  type UploadArchiveDeps,
} from "../uploadArchive.js";
import type { RemoteStatResult } from "../remoteStat.js";
import type { OffsiteSettings } from "../settings.js";

const FIXTURES_DIR = path.resolve(
  __dirname,
  "../../../../test-data/rclone-stats",
);
const readFixture = (name: string): string =>
  readFileSync(path.join(FIXTURES_DIR, name), "utf8");

const settings: OffsiteSettings = {
  remote: "chiro-coffre",
  bucket: "chiro-manon",
  prefix: "vigie-chiro",
};

/** A `remoteStat` fake that never gets to matter unless a test reads its
 * calls — most tests don't reach the code-0 verification branch at all. */
const unreachableRemoteStat: RemoteStatFn = () => {
  throw new Error("remoteStat should not have been called in this test");
};

const okRemoteStat = (result: RemoteStatResult): RemoteStatFn => {
  return () => Promise.resolve(result);
};

/**
 * The neutral verification stub, for tests whose subject is something other
 * than verification (progress, abort races, exit-code mapping). It reports the
 * object present at exactly the size the caller announced, so the run's
 * outcome reflects only what the test is actually exercising. Passing an
 * `absent` stub here instead would now fail those runs for an unrelated
 * reason — `absent` is a definite negative, not a neutral placeholder.
 */
const verifiedRemoteStat = (bytes: number): RemoteStatFn =>
  okRemoteStat({
    kind: "present",
    bytes,
    modTime: "2026-08-17T00:00:00Z",
    tier: "GLACIER",
  });

const makeFakeRclone = async (
  dir: string,
  name: string,
  script: string,
): Promise<string> => {
  const p = path.join(dir, name);
  await writeFileAsync(p, `#!/bin/sh\n${script}\n`);
  await chmod(p, 0o755);
  return p;
};

/** Polls for a marker file instead of guessing a fixed delay: a shell's
 * `trap` line needs to have actually run before a signal sent to it can be
 * caught rather than hit the untrapped default action, and how long that
 * takes depends on system load, not wall-clock time this suite controls. */
const waitForFile = async (
  filePath: string,
  timeoutMs = 2000,
): Promise<void> => {
  const start = Date.now();
  while (!existsSync(filePath)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

/** Emits a single `--use-json-log --stats` line to stderr, matching real
 * rclone's shape, then exits with the given code. */
const statsLine = (bytes: number, errors = 0, fatalError = false): string =>
  JSON.stringify({ stats: { bytes, errors, fatalError } });

describe("uploadArchive", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-upload-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const baseOptions = {
    platform: "linux" as NodeJS.Platform,
    settings,
    key: "study_20260817.zip",
    localPath: "/tmp/does-not-need-to-exist.zip",
    localBytes: 1_073_741_824,
  };

  // -------------------------------------------------------------------
  // Replaying real fixtures
  // -------------------------------------------------------------------

  it("upload-1gb-nominal.jsonl: progress is monotone, ends at the local size, never exceeds it", async () => {
    const fixture = readFixture("upload-1gb-nominal.jsonl");
    const bin = await makeFakeRclone(
      tmpDir,
      "fake-rclone",
      `cat <<'RCLONE_EOF' >&2\n${fixture}RCLONE_EOF\nexit 0`,
    );

    const seen: number[] = [];
    const deps: UploadArchiveDeps = {
      spawn: nodeRcloneSpawn,
      remoteStat: okRemoteStat({
        kind: "present",
        bytes: 1_073_741_824,
        modTime: "2026-08-17T09:00:00+02:00",
        tier: "GLACIER",
      }),
    };

    const result = await uploadArchive(deps, {
      ...baseOptions,
      rcloneBinPath: bin,
      onProgress: (bytesTransferred) => seen.push(bytesTransferred),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("type narrowing");
    expect(result.verified).toBe("size-match");
    expect(result.bytesSent).toBe(1_073_741_824);

    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1] ?? 0);
    }
    expect(seen.every((b) => b <= baseOptions.localBytes)).toBe(true);
    expect(seen.at(-1)).toBe(1_073_741_824);
  });

  // -------------------------------------------------------------------
  // Monotone clamping
  // -------------------------------------------------------------------

  it("never emits a value lower than a previous one, even when a tick reports fewer bytes", async () => {
    const script = [
      `echo '${statsLine(1000)}' >&2`,
      `echo '${statsLine(500)}' >&2`,
      "exit 0",
    ].join("\n");
    const bin = await makeFakeRclone(tmpDir, "fake-rclone", script);

    const seen: number[] = [];
    const deps: UploadArchiveDeps = {
      spawn: nodeRcloneSpawn,
      remoteStat: verifiedRemoteStat(1000),
    };

    const result = await uploadArchive(deps, {
      ...baseOptions,
      localBytes: 1000,
      rcloneBinPath: bin,
      onProgress: (b) => seen.push(b),
    });

    expect(result.kind).toBe("ok");
    expect(seen).toEqual([1000, 1000]);
  });

  // -------------------------------------------------------------------
  // Abort escalation
  // -------------------------------------------------------------------

  it("escalates to SIGKILL and terminates when the fake ignores SIGINT (bounded, not the vitest timeout)", async () => {
    // No subprocess (a `sleep &` would keep the pipe open past our SIGKILL,
    // since SIGKILL never reaches a child it didn't target) and no
    // ignorable-through-exec trick: a builtin busy-loop is the same PID our
    // SIGKILL targets, so it dies the instant we send it.
    const bin = await makeFakeRclone(
      tmpDir,
      "fake-rclone",
      "trap '' INT\nwhile true; do :; done",
    );

    const deps: UploadArchiveDeps = {
      spawn: nodeRcloneSpawn,
      remoteStat: unreachableRemoteStat,
    };

    const controller = new AbortController();
    const resultPromise = uploadArchive(deps, {
      ...baseOptions,
      rcloneBinPath: bin,
      signal: controller.signal,
      sigintResendMs: 30,
      killEscalationMs: 80,
    });

    controller.abort();
    const result = await resultPromise;

    expect(result.kind).toBe("aborted");
  }, 5000);

  it("reports success, not abandonment, when the fake traps SIGINT and exits 0 (the race)", async () => {
    const readyMarker = path.join(tmpDir, "ready");
    const bin = await makeFakeRclone(
      tmpDir,
      "fake-rclone",
      `trap 'exit 0' INT\ntouch '${readyMarker}'\nwhile true; do :; done`,
    );

    const deps: UploadArchiveDeps = {
      spawn: nodeRcloneSpawn,
      remoteStat: verifiedRemoteStat(1_073_741_824),
    };

    const controller = new AbortController();
    const resultPromise = uploadArchive(deps, {
      ...baseOptions,
      rcloneBinPath: bin,
      signal: controller.signal,
      sigintResendMs: 5000,
      killEscalationMs: 15_000,
    });

    // The fake must have actually installed its trap before SIGINT can be
    // caught by it, rather than hitting the untrapped default disposition
    // (which would just kill it — a different scenario than the one this
    // test targets). Waiting for the marker it writes right after `trap`
    // is deterministic; a fixed sleep here was flaky under load.
    await waitForFile(readyMarker);
    controller.abort();
    const result = await resultPromise;

    expect(result.kind).toBe("ok");
  }, 5000);

  // -------------------------------------------------------------------
  // Exit code mapping
  // -------------------------------------------------------------------

  it("exit 130 (without us ever requesting an abort) is reported as aborted", async () => {
    const bin = await makeFakeRclone(tmpDir, "fake-rclone", "exit 130");
    const deps: UploadArchiveDeps = {
      spawn: nodeRcloneSpawn,
      remoteStat: unreachableRemoteStat,
    };
    const result = await uploadArchive(deps, {
      ...baseOptions,
      rcloneBinPath: bin,
    });
    expect(result.kind).toBe("aborted");
  });

  it("exit 5 is a transient error", async () => {
    const bin = await makeFakeRclone(tmpDir, "fake-rclone", "exit 5");
    const deps: UploadArchiveDeps = {
      spawn: nodeRcloneSpawn,
      remoteStat: unreachableRemoteStat,
    };
    const result = await uploadArchive(deps, {
      ...baseOptions,
      rcloneBinPath: bin,
    });
    expect(result).toMatchObject({
      kind: "error",
      code: "transient",
      bytesSent: 0,
    });
  });

  it("exit 7 is a fatal error", async () => {
    const bin = await makeFakeRclone(tmpDir, "fake-rclone", "exit 7");
    const deps: UploadArchiveDeps = {
      spawn: nodeRcloneSpawn,
      remoteStat: unreachableRemoteStat,
    };
    const result = await uploadArchive(deps, {
      ...baseOptions,
      rcloneBinPath: bin,
    });
    expect(result).toMatchObject({ kind: "error", code: "fatal" });
  });

  it("exit 3 is bucket-missing", async () => {
    const bin = await makeFakeRclone(tmpDir, "fake-rclone", "exit 3");
    const deps: UploadArchiveDeps = {
      spawn: nodeRcloneSpawn,
      remoteStat: unreachableRemoteStat,
    };
    const result = await uploadArchive(deps, {
      ...baseOptions,
      rcloneBinPath: bin,
    });
    expect(result).toMatchObject({ kind: "error", code: "bucket-missing" });
  });

  it("exit 1 is config-error", async () => {
    const bin = await makeFakeRclone(tmpDir, "fake-rclone", "exit 1");
    const deps: UploadArchiveDeps = {
      spawn: nodeRcloneSpawn,
      remoteStat: unreachableRemoteStat,
    };
    const result = await uploadArchive(deps, {
      ...baseOptions,
      rcloneBinPath: bin,
    });
    expect(result).toMatchObject({ kind: "error", code: "config-error" });
  });

  it("an unmapped exit code becomes rclone-exit:<N>", async () => {
    const bin = await makeFakeRclone(tmpDir, "fake-rclone", "exit 42");
    const deps: UploadArchiveDeps = {
      spawn: nodeRcloneSpawn,
      remoteStat: unreachableRemoteStat,
    };
    const result = await uploadArchive(deps, {
      ...baseOptions,
      rcloneBinPath: bin,
    });
    expect(result).toMatchObject({ kind: "error", code: "rclone-exit:42" });
  });

  // -------------------------------------------------------------------
  // Retry-then-success
  // -------------------------------------------------------------------

  it("a tick with errors > 0 followed by exit 0 is a success — rclone retried and won", async () => {
    const script = [`echo '${statsLine(500, 1, false)}' >&2`, "exit 0"].join(
      "\n",
    );
    const bin = await makeFakeRclone(tmpDir, "fake-rclone", script);
    const deps: UploadArchiveDeps = {
      spawn: nodeRcloneSpawn,
      remoteStat: verifiedRemoteStat(500),
    };
    const result = await uploadArchive(deps, {
      ...baseOptions,
      localBytes: 500,
      rcloneBinPath: bin,
    });
    expect(result.kind).toBe("ok");
  });

  // -------------------------------------------------------------------
  // Verification
  // -------------------------------------------------------------------

  it("a size mismatch on verification is verify-failed, not a success", async () => {
    const bin = await makeFakeRclone(
      tmpDir,
      "fake-rclone",
      `echo '${statsLine(1000)}' >&2\nexit 0`,
    );
    const deps: UploadArchiveDeps = {
      spawn: nodeRcloneSpawn,
      remoteStat: okRemoteStat({
        kind: "present",
        bytes: 999,
        modTime: "2026-08-17T09:00:00+02:00",
        tier: "GLACIER",
      }),
    };
    const result = await uploadArchive(deps, {
      ...baseOptions,
      localBytes: 1000,
      rcloneBinPath: bin,
    });
    expect(result).toMatchObject({ kind: "error", code: "verify-failed" });
  });

  it("an absent object after a reported success is verify-absent, not a success", async () => {
    // The store answered, and it said no. That is a definite negative, not
    // the "we could not ask" uncertainty that rides along with a success —
    // and its realistic cause is writing to one key and reading back another,
    // which would otherwise archive nothing while reporting all is well.
    const bin = await makeFakeRclone(
      tmpDir,
      "fake-rclone",
      `echo '${statsLine(1000)}' >&2\nexit 0`,
    );
    const deps: UploadArchiveDeps = {
      spawn: nodeRcloneSpawn,
      remoteStat: okRemoteStat({ kind: "absent" }),
    };
    const result = await uploadArchive(deps, {
      ...baseOptions,
      localBytes: 1000,
      rcloneBinPath: bin,
    });
    expect(result).toMatchObject({ kind: "error", code: "verify-absent" });
  });

  it("an unavailable verification (remoteStat error) is still a success", async () => {
    const bin = await makeFakeRclone(
      tmpDir,
      "fake-rclone",
      `echo '${statsLine(1000)}' >&2\nexit 0`,
    );
    const deps: UploadArchiveDeps = {
      spawn: nodeRcloneSpawn,
      remoteStat: okRemoteStat({ kind: "error", code: "network" }),
    };
    const result = await uploadArchive(deps, {
      ...baseOptions,
      localBytes: 1000,
      rcloneBinPath: bin,
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("type narrowing");
    expect(result.verified).toBe("unavailable");
  });

  // -------------------------------------------------------------------
  // Spawn failure
  // -------------------------------------------------------------------

  it("returns rclone-spawn-failed when the binary cannot be spawned", async () => {
    const deps: UploadArchiveDeps = {
      spawn: nodeRcloneSpawn,
      remoteStat: unreachableRemoteStat,
    };
    const result = await uploadArchive(deps, {
      ...baseOptions,
      rcloneBinPath: path.join(tmpDir, "does-not-exist"),
    });
    expect(result).toMatchObject({
      kind: "error",
      code: "rclone-spawn-failed",
    });
  });
});
