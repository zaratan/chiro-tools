import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { remoteStat, type RemoteStatDeps } from "../remoteStat.js";
import type { OffsiteSettings } from "../settings.js";

const settings: OffsiteSettings = {
  remote: "chiro-coffre",
  bucket: "chiro-manon",
  prefix: "vigie-chiro",
};

const makeFakeRclone = async (
  dir: string,
  name: string,
  script: string,
): Promise<string> => {
  const p = path.join(dir, name);
  await writeFile(p, `#!/bin/sh\n${script}\n`);
  await chmod(p, 0o755);
  return p;
};

describe("remoteStat", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-remotestat-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reads a present object — IsDir: false, real Size/ModTime/Tier, exit 0", async () => {
    const bin = await makeFakeRclone(
      tmpDir,
      "fake-rclone",
      `cat <<'EOF'
{"IsDir": false, "Size": 12582912, "Tier": "GLACIER", "ModTime": "2026-08-17T09:00:00+02:00"}
EOF
exit 0`,
    );
    const deps: RemoteStatDeps = { binPath: bin };
    const result = await remoteStat(deps, { settings, key: "x.zip" });
    expect(result).toEqual({
      kind: "present",
      bytes: 12582912,
      modTime: "2026-08-17T09:00:00+02:00",
      tier: "GLACIER",
    });
  });

  it("treats an absent object as absent, NOT present at size -1 — the pseudo-directory case, exit 0", async () => {
    const bin = await makeFakeRclone(
      tmpDir,
      "fake-rclone",
      `cat <<'EOF'
{"IsDir": true, "Size": -1, "MimeType": "inode/directory"}
EOF
exit 0`,
    );
    const deps: RemoteStatDeps = { binPath: bin };
    const result = await remoteStat(deps, { settings, key: "missing.zip" });
    expect(result).toEqual({ kind: "absent" });
  });

  it("maps exit 3 to bucket-missing", async () => {
    const bin = await makeFakeRclone(
      tmpDir,
      "fake-rclone",
      `echo "Failed to lsjson: directory not found" >&2
exit 3`,
    );
    const deps: RemoteStatDeps = { binPath: bin };
    const result = await remoteStat(deps, { settings, key: "x.zip" });
    expect(result).toEqual({ kind: "bucket-missing" });
  });

  it("maps exit 1 to config-error", async () => {
    const bin = await makeFakeRclone(
      tmpDir,
      "fake-rclone",
      `echo "didn't find section in config file" >&2
exit 1`,
    );
    const deps: RemoteStatDeps = { binPath: bin };
    const result = await remoteStat(deps, { settings, key: "x.zip" });
    expect(result).toEqual({ kind: "config-error" });
  });

  it("maps an unrecognised exit code to a generic error", async () => {
    const bin = await makeFakeRclone(tmpDir, "fake-rclone", "exit 42");
    const deps: RemoteStatDeps = { binPath: bin };
    const result = await remoteStat(deps, { settings, key: "x.zip" });
    expect(result).toEqual({ kind: "error", code: "rclone-exit:42" });
  });

  it("returns aborted immediately on a pre-aborted signal, without spawning", async () => {
    const bin = await makeFakeRclone(tmpDir, "fake-rclone", "exit 0");
    const deps: RemoteStatDeps = { binPath: bin };
    const controller = new AbortController();
    controller.abort();
    const result = await remoteStat(deps, {
      settings,
      key: "x.zip",
      signal: controller.signal,
    });
    expect(result).toEqual({ kind: "aborted" });
  });

  it("hard-kills and returns aborted when the signal fires mid-run", async () => {
    const bin = await makeFakeRclone(
      tmpDir,
      "fake-rclone",
      // No subprocess, no ignorable trap: SIGKILL ends this instantly.
      "while true; do :; done",
    );
    const deps: RemoteStatDeps = { binPath: bin };
    const controller = new AbortController();
    const resultPromise = remoteStat(deps, {
      settings,
      key: "x.zip",
      signal: controller.signal,
    });
    controller.abort();
    const result = await resultPromise;
    expect(result).toEqual({ kind: "aborted" });
  }, 5000);

  it("returns rclone-spawn-failed when the binary cannot be spawned", async () => {
    const deps: RemoteStatDeps = {
      binPath: path.join(tmpDir, "does-not-exist"),
    };
    const result = await remoteStat(deps, { settings, key: "x.zip" });
    expect(result).toEqual({ kind: "error", code: "rclone-spawn-failed" });
  });
});
