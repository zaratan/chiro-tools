import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveInstallDirEnv } from "./installDir.js";

describe("resolveInstallDirEnv", () => {
  let dir: string;

  beforeEach(async () => {
    // realpath: on macOS tmpdir() lives under /var, a symlink to /private/var.
    dir = await realpath(
      await mkdtemp(path.join(tmpdir(), "chiro-installdir-")),
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the binary directory for an installed chiro binary", async () => {
    const binPath = path.join(dir, "chiro");
    await writeFile(binPath, "");
    expect(resolveInstallDirEnv(binPath, {})).toEqual({
      CHIRO_INSTALL_DIR: dir,
    });
  });

  it("returns no override for a hand-extracted release artifact", async () => {
    const binPath = path.join(dir, "chiro-darwin-arm64");
    await writeFile(binPath, "");
    expect(resolveInstallDirEnv(binPath, {})).toEqual({});
  });

  it("returns no override when the executable is not a chiro binary", async () => {
    const binPath = path.join(dir, "bun");
    await writeFile(binPath, "");
    expect(resolveInstallDirEnv(binPath, {})).toEqual({});
  });

  it("returns no override when the user already set CHIRO_INSTALL_DIR", async () => {
    const binPath = path.join(dir, "chiro");
    await writeFile(binPath, "");
    expect(
      resolveInstallDirEnv(binPath, { CHIRO_INSTALL_DIR: "/somewhere" }),
    ).toEqual({});
  });

  it("returns no override when the executable path does not resolve", () => {
    expect(resolveInstallDirEnv(path.join(dir, "missing"), {})).toEqual({});
  });
});
