import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isHomebrewInstall } from "./isHomebrewInstall.js";

describe("isHomebrewInstall — pure function via injected execPath", () => {
  it("returns true for a macOS arm64 Homebrew install path", () => {
    expect(
      isHomebrewInstall("/opt/homebrew/Cellar/chiro/0.1.8/bin/chiro"),
    ).toBe(true);
  });

  it("returns true for a Linuxbrew install path", () => {
    expect(
      isHomebrewInstall(
        "/home/linuxbrew/.linuxbrew/Cellar/chiro/0.1.8/bin/chiro",
      ),
    ).toBe(true);
  });

  it("returns false for an install.sh path", () => {
    expect(isHomebrewInstall("/Users/x/.local/bin/chiro")).toBe(false);
  });

  it("returns false for an Intel macOS user install path", () => {
    expect(isHomebrewInstall("/usr/local/bin/chiro")).toBe(false);
  });

  it("returns false for a dev bun path (without brew)", () => {
    expect(isHomebrewInstall("/Users/x/.bun/bin/bun")).toBe(false);
  });
});

describe("isHomebrewInstall — integration: symlink resolution", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-brew-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns true when execPath is a symlink into a /Cellar/ directory", async () => {
    const realBin = path.join(
      tmpDir,
      "Cellar",
      "chiro",
      "0.1.8",
      "bin",
      "chiro",
    );
    await mkdir(path.dirname(realBin), { recursive: true });
    await writeFile(realBin, "");

    const symBinDir = path.join(tmpDir, "bin");
    await mkdir(symBinDir, { recursive: true });
    const symLink = path.join(symBinDir, "chiro");
    await symlink(realBin, symLink);

    expect(isHomebrewInstall(symLink)).toBe(true);
  });

  it("falls back to the raw execPath when realpathSync throws (e.g. ENOENT)", () => {
    const missing = path.join(tmpDir, "Cellar", "chiro", "missing", "chiro");
    expect(isHomebrewInstall(missing)).toBe(true);

    const missingNonBrew = path.join(tmpDir, "bin", "missing-chiro");
    expect(isHomebrewInstall(missingNonBrew)).toBe(false);
  });
});
