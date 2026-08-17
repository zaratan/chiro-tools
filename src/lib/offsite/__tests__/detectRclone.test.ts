import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectRclone } from "../detectRclone.js";

const makeFakeRclone = async (
  dir: string,
  versionOutput: string,
  exitCode = 0,
): Promise<string> => {
  const p = path.join(dir, "rclone");
  await writeFile(
    p,
    `#!/bin/sh\nprintf '%s\\n' "${versionOutput}"\nexit ${String(exitCode)}\n`,
  );
  await chmod(p, 0o755);
  return p;
};

describe("detectRclone", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-rclone-detect-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    delete process.env.CHIRO_DISABLE_OFFSITE;
    delete process.env.PATH;
  });

  it("returns absent when CHIRO_DISABLE_OFFSITE is set", () => {
    process.env.CHIRO_DISABLE_OFFSITE = "1";
    process.env.PATH = tmpDir;
    expect(detectRclone()).toEqual({ kind: "absent" });
  });

  it("returns absent when rclone is not on PATH", () => {
    process.env.PATH = tmpDir;
    delete process.env.CHIRO_DISABLE_OFFSITE;
    expect(detectRclone()).toEqual({ kind: "absent" });
  });

  it("returns absent when rclone version exits non-zero", async () => {
    await makeFakeRclone(tmpDir, "rclone v1.75.0", 1);
    process.env.PATH = tmpDir;
    delete process.env.CHIRO_DISABLE_OFFSITE;
    expect(detectRclone()).toEqual({ kind: "absent" });
  });

  it("returns absent when the version line is unreadable", async () => {
    await makeFakeRclone(tmpDir, "not a version string at all");
    process.env.PATH = tmpDir;
    delete process.env.CHIRO_DISABLE_OFFSITE;
    expect(detectRclone()).toEqual({ kind: "absent" });
  });

  it("returns too-old below the 1.53.0 floor", async () => {
    const binPath = await makeFakeRclone(tmpDir, "rclone v1.50.2");
    process.env.PATH = tmpDir;
    delete process.env.CHIRO_DISABLE_OFFSITE;
    expect(detectRclone()).toEqual({
      kind: "too-old",
      binPath,
      version: "1.50.2",
    });
  });

  it("returns available at exactly the floor version", async () => {
    const binPath = await makeFakeRclone(tmpDir, "rclone v1.53.0");
    process.env.PATH = tmpDir;
    delete process.env.CHIRO_DISABLE_OFFSITE;
    expect(detectRclone()).toEqual({
      kind: "available",
      binPath,
      version: "1.53.0",
    });
  });

  it("returns available above the floor", async () => {
    const binPath = await makeFakeRclone(tmpDir, "rclone v1.75.0");
    process.env.PATH = tmpDir;
    delete process.env.CHIRO_DISABLE_OFFSITE;
    expect(detectRclone()).toEqual({
      kind: "available",
      binPath,
      version: "1.75.0",
    });
  });
});
