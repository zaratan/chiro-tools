import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ARCHIVED_DIR_DISPLAY,
  ARCHIVED_DIRNAME,
  buildArchivedDir,
  buildArchiveName,
  collisionNameCandidates,
  resolveArchiveFileName,
  resolveFreeName,
  scanProcessedForArchive,
} from "../planArchive.js";

describe("buildArchivedDir / ARCHIVED_DIR_DISPLAY", () => {
  it("joins the archived dirname onto the given directory", () => {
    expect(buildArchivedDir("/home/user/bats")).toBe(
      path.join("/home/user/bats", ARCHIVED_DIRNAME),
    );
  });

  it("exposes the display form used in UI copy", () => {
    expect(ARCHIVED_DIR_DISPLAY).toBe("./archived/");
  });
});

describe("buildArchiveName", () => {
  it("formats as processed_YYYYMMDD.zip in local time, zero-padded", () => {
    expect(buildArchiveName(new Date(2026, 7, 12, 14, 30))).toBe(
      "processed_20260812.zip",
    );
  });

  it("zero-pads single-digit month and day", () => {
    expect(buildArchiveName(new Date(2026, 0, 2, 3, 4))).toBe(
      "processed_20260102.zip",
    );
  });

  it("uses the given prefix instead of processed when provided", () => {
    expect(
      buildArchiveName(new Date(2026, 7, 14), "Car340581-2026-Pass1-A1"),
    ).toBe("Car340581-2026-Pass1-A1_20260814.zip");
  });
});

describe("resolveArchiveFileName", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-test-archivename-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns the base name unchanged when it doesn't exist yet", async () => {
    const result = await resolveArchiveFileName(tmpDir, "processed_x.zip");
    expect(result).toEqual({ kind: "ok", fileName: "processed_x.zip" });
  });

  it("suffixes with -2 when the base name already exists", async () => {
    await writeFile(path.join(tmpDir, "processed_x.zip"), "");
    const result = await resolveArchiveFileName(tmpDir, "processed_x.zip");
    expect(result).toEqual({ kind: "ok", fileName: "processed_x-2.zip" });
  });

  it("skips over occupied suffixes to find the first free one", async () => {
    await writeFile(path.join(tmpDir, "processed_x.zip"), "");
    await writeFile(path.join(tmpDir, "processed_x-2.zip"), "");
    await writeFile(path.join(tmpDir, "processed_x-3.zip"), "");
    const result = await resolveArchiveFileName(tmpDir, "processed_x.zip");
    expect(result).toEqual({ kind: "ok", fileName: "processed_x-4.zip" });
  });

  it("returns collision-exhausted once suffixes -2..-99 are all taken", async () => {
    await writeFile(path.join(tmpDir, "processed_x.zip"), "");
    for (let i = 2; i <= 99; i++) {
      await writeFile(path.join(tmpDir, `processed_x-${i.toString()}.zip`), "");
    }
    const result = await resolveArchiveFileName(tmpDir, "processed_x.zip");
    expect(result).toEqual({ kind: "collision-exhausted" });
  });

  it("is the same function as resolveFreeName (generalized in 9.B)", () => {
    expect(resolveArchiveFileName).toBe(resolveFreeName);
  });

  it("resolves a bare name with no extension (a directory name)", async () => {
    await mkdir(path.join(tmpDir, "depot_20260814"));
    const result = await resolveFreeName(tmpDir, "depot_20260814");
    expect(result).toEqual({ kind: "ok", fileName: "depot_20260814-2" });
  });
});

describe("collisionNameCandidates", () => {
  it("yields the base name first, then -2..-99 suffixes before the extension", () => {
    const candidates = [...collisionNameCandidates("processed_x.zip")];
    expect(candidates[0]).toBe("processed_x.zip");
    expect(candidates[1]).toBe("processed_x-2.zip");
    expect(candidates.at(-1)).toBe("processed_x-99.zip");
    expect(candidates).toHaveLength(99);
  });

  it("appends the suffix directly when the base name has no extension", () => {
    const candidates = [...collisionNameCandidates("depot_20260814")];
    expect(candidates[0]).toBe("depot_20260814");
    expect(candidates[1]).toBe("depot_20260814-2");
    expect(candidates.at(-1)).toBe("depot_20260814-99");
  });
});

describe("scanProcessedForArchive", () => {
  let tmpDir: string;
  let processedDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-test-scanarchive-"));
    processedDir = path.join(tmpDir, "processed");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns no-processed when the directory does not exist", async () => {
    const result = await scanProcessedForArchive(processedDir);
    expect(result).toEqual({ kind: "no-processed" });
  });

  it("returns empty-processed when the directory has no archivable entries", async () => {
    await mkdir(processedDir);
    await writeFile(path.join(processedDir, ".DS_Store"), "");
    await writeFile(path.join(processedDir, "leftover.wav.tmp"), "");
    const result = await scanProcessedForArchive(processedDir);
    expect(result).toEqual({ kind: "empty-processed" });
  });

  it("returns sorted entries with size and mtime, excluding dot and .tmp entries", async () => {
    await mkdir(processedDir);
    await writeFile(path.join(processedDir, "b_002.wav"), "1234");
    await writeFile(path.join(processedDir, "a_001.wav"), "12345678");
    await writeFile(path.join(processedDir, ".DS_Store"), "");
    await writeFile(path.join(processedDir, "c_003.wav.tmp"), "");

    const result = await scanProcessedForArchive(processedDir);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("type narrowing");
    expect(result.entries.map((e) => e.name)).toEqual([
      "a_001.wav",
      "b_002.wav",
    ]);
    expect(result.entries[0]?.size).toBe(8);
    expect(result.entries[1]?.size).toBe(4);
    expect(result.totalBytes).toBe(12);
    expect(result.entries[0]?.mtime).toBeInstanceOf(Date);
  });

  it("excludes subdirectories and symlinks, like scanDirectory does for wav files", async () => {
    await mkdir(processedDir);
    await mkdir(path.join(processedDir, "subdir"));
    const target = path.join(processedDir, "real.wav");
    await writeFile(target, "1234");
    await symlink(target, path.join(processedDir, "link.wav"));

    const result = await scanProcessedForArchive(processedDir);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("type narrowing");
    expect(result.entries.map((e) => e.name)).toEqual(["real.wav"]);
  });

  it("returns aborted, distinguishable from a completed scan, once the signal fires mid-stat", async () => {
    await mkdir(processedDir);
    await writeFile(path.join(processedDir, "a.wav"), "1234");

    const controller = new AbortController();
    controller.abort();

    const result = await scanProcessedForArchive(
      processedDir,
      controller.signal,
    );
    expect(result).toEqual({ kind: "aborted" });
  });

  it("returns scan-error when the path is not a directory", async () => {
    await writeFile(processedDir, "content");
    const result = await scanProcessedForArchive(processedDir);
    expect(result.kind).toBe("scan-error");
    if (result.kind !== "scan-error") throw new Error("type narrowing");
    expect(result.rawCode).toBe("ENOTDIR");
  });
});
