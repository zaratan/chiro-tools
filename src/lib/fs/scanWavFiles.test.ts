import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanWavFiles } from "./scanWavFiles.js";

describe("scanWavFiles", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-test-scan-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty array for an empty directory", async () => {
    const result = await scanWavFiles(tmpDir);
    expect(result).toEqual([]);
  });

  it("returns sorted WAV filenames when directory contains only WAV files", async () => {
    await writeFile(path.join(tmpDir, "c.wav"), "");
    await writeFile(path.join(tmpDir, "a.wav"), "");
    await writeFile(path.join(tmpDir, "b.wav"), "");

    const result = await scanWavFiles(tmpDir);
    expect(result).toEqual(["a.wav", "b.wav", "c.wav"]);
  });

  it("filters out non-WAV extensions, keeping only .wav and .WAV", async () => {
    await writeFile(path.join(tmpDir, "recording.wav"), "");
    await writeFile(path.join(tmpDir, "UPPERCASE.WAV"), "");
    await writeFile(path.join(tmpDir, "notes.txt"), "");
    await writeFile(path.join(tmpDir, "log.log"), "");
    await writeFile(path.join(tmpDir, "backup.wav.bak"), "");

    const result = await scanWavFiles(tmpDir);
    expect(result).toEqual(["UPPERCASE.WAV", "recording.wav"]);
  });

  it("ignores dotfiles even when they have a .wav extension", async () => {
    await writeFile(path.join(tmpDir, ".foo.wav"), "");
    await writeFile(path.join(tmpDir, ".DS_Store"), "");
    await writeFile(path.join(tmpDir, "visible.wav"), "");

    const result = await scanWavFiles(tmpDir);
    expect(result).toEqual(["visible.wav"]);
  });

  it("ignores subdirectories", async () => {
    await mkdir(path.join(tmpDir, "subdir"));
    await writeFile(path.join(tmpDir, "subdir", "nested.wav"), "");
    await writeFile(path.join(tmpDir, "top.wav"), "");

    const result = await scanWavFiles(tmpDir);
    expect(result).toEqual(["top.wav"]);
  });

  it("ignores symlinks", async () => {
    const targetFile = path.join(tmpDir, "real.wav");
    await writeFile(targetFile, "");
    await symlink(targetFile, path.join(tmpDir, "link.wav"));

    const result = await scanWavFiles(tmpDir);
    // Only the real file — not the symlink — should appear
    expect(result).toEqual(["real.wav"]);
  });

  it("returns names sorted alphabetically regardless of creation order", async () => {
    await writeFile(path.join(tmpDir, "c.wav"), "");
    await writeFile(path.join(tmpDir, "a.wav"), "");
    await writeFile(path.join(tmpDir, "b.wav"), "");

    const result = await scanWavFiles(tmpDir);
    expect(result).toEqual(["a.wav", "b.wav", "c.wav"]);
  });

  it("handles realistic Vigie-Chiro Teensy recorder filenames", async () => {
    await writeFile(
      path.join(tmpDir, "PaRecPR1925645_20260507_210004.wav"),
      "",
    );
    await writeFile(
      path.join(tmpDir, "PaRecPR1925645_20260507_210009.wav"),
      "",
    );
    await writeFile(path.join(tmpDir, "LogPR1925645.txt"), "");

    const result = await scanWavFiles(tmpDir);
    expect(result).toEqual([
      "PaRecPR1925645_20260507_210004.wav",
      "PaRecPR1925645_20260507_210009.wav",
    ]);
  });
});
