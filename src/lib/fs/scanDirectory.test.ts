import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkProcessedDirConflict,
  scanDirectory,
  sumFileSizes,
} from "./scanDirectory.js";

// chmod-based access-denial tests are meaningless under root (which bypasses
// permission checks) — skip them there instead of producing a false failure.
const isRoot = process.getuid?.() === 0;
const itUnlessRoot = isRoot ? it.skip : it;

describe("scanDirectory", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-test-scandir-"));
  });

  afterEach(async () => {
    // Restore permissions before recursive removal — a 000/500 dir would
    // otherwise make its own cleanup fail.
    await chmod(tmpDir, 0o700).catch(() => undefined);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty list and zero ignored count for an empty directory", async () => {
    const result = await scanDirectory(tmpDir);
    expect(result).toEqual({ kind: "ok", wavFiles: [], ignoredFileCount: 0 });
  });

  it("returns sorted WAV filenames, case-insensitive on extension", async () => {
    await writeFile(path.join(tmpDir, "c.wav"), "");
    await writeFile(path.join(tmpDir, "a.wav"), "");
    await writeFile(path.join(tmpDir, "B.WAV"), "");

    const result = await scanDirectory(tmpDir);
    expect(result).toEqual({
      kind: "ok",
      wavFiles: ["B.WAV", "a.wav", "c.wav"],
      ignoredFileCount: 0,
    });
  });

  it("counts non-wav visible files as ignored, without listing them", async () => {
    await writeFile(path.join(tmpDir, "recording.wav"), "");
    await writeFile(path.join(tmpDir, "notes.txt"), "");
    await writeFile(path.join(tmpDir, "log.log"), "");
    await writeFile(path.join(tmpDir, "backup.wav.bak"), "");

    const result = await scanDirectory(tmpDir);
    expect(result).toEqual({
      kind: "ok",
      wavFiles: ["recording.wav"],
      ignoredFileCount: 3,
    });
  });

  it("ignores dotfiles entirely (not counted as ignored either)", async () => {
    await writeFile(path.join(tmpDir, ".foo.wav"), "");
    await writeFile(path.join(tmpDir, ".DS_Store"), "");
    await writeFile(path.join(tmpDir, "visible.wav"), "");

    const result = await scanDirectory(tmpDir);
    expect(result).toEqual({
      kind: "ok",
      wavFiles: ["visible.wav"],
      ignoredFileCount: 0,
    });
  });

  it("ignores subdirectories entirely (not counted as ignored either)", async () => {
    await mkdir(path.join(tmpDir, "subdir"));
    await writeFile(path.join(tmpDir, "subdir", "nested.wav"), "");
    await writeFile(path.join(tmpDir, "top.wav"), "");

    const result = await scanDirectory(tmpDir);
    expect(result).toEqual({
      kind: "ok",
      wavFiles: ["top.wav"],
      ignoredFileCount: 0,
    });
  });

  it("ignores symlinks", async () => {
    const targetFile = path.join(tmpDir, "real.wav");
    await writeFile(targetFile, "");
    await symlink(targetFile, path.join(tmpDir, "link.wav"));

    const result = await scanDirectory(tmpDir);
    expect(result).toEqual({
      kind: "ok",
      wavFiles: ["real.wav"],
      ignoredFileCount: 0,
    });
  });

  itUnlessRoot(
    "returns not-readable when the directory cannot be read",
    async () => {
      await chmod(tmpDir, 0o000);

      const result = await scanDirectory(tmpDir);
      expect(result).toEqual({ kind: "not-readable" });
    },
  );

  itUnlessRoot(
    "returns not-writable when the directory cannot be written to",
    async () => {
      await chmod(tmpDir, 0o500);

      const result = await scanDirectory(tmpDir);
      expect(result).toEqual({ kind: "not-writable" });
    },
  );

  it("returns scan-error when the path is not a directory", async () => {
    const filePath = path.join(tmpDir, "not-a-dir");
    await writeFile(filePath, "content");

    const result = await scanDirectory(filePath);
    expect(result.kind).toBe("scan-error");
    if (result.kind !== "scan-error") throw new Error("type narrowing");
    expect(result.rawCode).toBe("ENOTDIR");
  });
});

describe("sumFileSizes", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-test-sumsizes-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns ok with totalBytes: 0 for an empty file list", async () => {
    expect(await sumFileSizes(tmpDir, [])).toEqual({
      kind: "ok",
      totalBytes: 0,
    });
  });

  it("sums the sizes of the given files", async () => {
    await writeFile(path.join(tmpDir, "a.wav"), "1234");
    await writeFile(path.join(tmpDir, "b.wav"), "12345678");

    const result = await sumFileSizes(tmpDir, ["a.wav", "b.wav"]);
    expect(result).toEqual({ kind: "ok", totalBytes: 12 });
  });

  it("skips files that fail to stat, without throwing", async () => {
    await writeFile(path.join(tmpDir, "a.wav"), "1234");

    const result = await sumFileSizes(tmpDir, ["a.wav", "missing.wav"]);
    expect(result).toEqual({ kind: "ok", totalBytes: 4 });
  });

  it("returns aborted, distinguishable from a completed sum, as soon as the signal is aborted", async () => {
    await writeFile(path.join(tmpDir, "a.wav"), "1234");
    await writeFile(path.join(tmpDir, "b.wav"), "12345678");

    const controller = new AbortController();
    controller.abort();

    const result = await sumFileSizes(
      tmpDir,
      ["a.wav", "b.wav"],
      controller.signal,
    );
    expect(result).toEqual({ kind: "aborted" });
  });
});

describe("checkProcessedDirConflict", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-test-processed-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns exists: false when the directory does not exist", async () => {
    const result = await checkProcessedDirConflict(
      path.join(tmpDir, "processed"),
    );
    expect(result).toEqual({ exists: false, nonTmpCount: 0 });
  });

  it("returns exists: true and nonTmpCount: 0 for a dir with only .tmp entries", async () => {
    const processedDir = path.join(tmpDir, "processed");
    await mkdir(processedDir);
    await writeFile(path.join(processedDir, "a.wav.tmp"), "");

    const result = await checkProcessedDirConflict(processedDir);
    expect(result).toEqual({ exists: true, nonTmpCount: 0 });
  });

  it("counts only non-.tmp entries", async () => {
    const processedDir = path.join(tmpDir, "processed");
    await mkdir(processedDir);
    await writeFile(path.join(processedDir, "a_001.wav"), "");
    await writeFile(path.join(processedDir, "a_002.wav"), "");
    await writeFile(path.join(processedDir, "b.wav.tmp"), "");

    const result = await checkProcessedDirConflict(processedDir);
    expect(result).toEqual({ exists: true, nonTmpCount: 2 });
  });

  it("returns exists: false when the path is a file, not a directory", async () => {
    const filePath = path.join(tmpDir, "processed");
    await writeFile(filePath, "content");

    const result = await checkProcessedDirConflict(filePath);
    expect(result).toEqual({ exists: false, nonTmpCount: 0 });
  });
});
