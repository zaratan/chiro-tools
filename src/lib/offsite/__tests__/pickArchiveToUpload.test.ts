import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pickArchiveToUpload } from "../pickArchiveToUpload.js";

describe("pickArchiveToUpload", () => {
  let dir: string;
  let archivedDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "chiro-pick-archive-"));
    archivedDir = path.join(dir, "archived");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const setMtime = async (filePath: string, date: Date): Promise<void> => {
    await utimes(filePath, date, date);
  };

  it("returns none when archivedDir does not exist", async () => {
    const result = await pickArchiveToUpload(archivedDir);
    expect(result).toEqual({ kind: "none" });
  });

  it("returns none when archivedDir exists but has no matching zips", async () => {
    await mkdir(archivedDir);
    await writeFile(path.join(archivedDir, "notes.txt"), "hello", "utf8");
    const result = await pickArchiveToUpload(archivedDir);
    expect(result).toEqual({ kind: "none" });
  });

  it("picks the single matching zip with otherCount 0", async () => {
    await mkdir(archivedDir);
    const zipPath = path.join(archivedDir, "processed_20260812.zip");
    await writeFile(zipPath, "zip-content", "utf8");

    const result = await pickArchiveToUpload(archivedDir);
    if (result.kind !== "ok") throw new Error("expected ok");

    expect(result.otherCount).toBe(0);
    expect(result.chosen.name).toBe("processed_20260812.zip");
    expect(result.chosen.path).toBe(zipPath);
    expect(result.chosen.size).toBe("zip-content".length);
  });

  it("picks the most recent by mtime and counts the rest as otherCount", async () => {
    await mkdir(archivedDir);
    const older = path.join(archivedDir, "processed_20260810.zip");
    const newer = path.join(archivedDir, "processed_20260812.zip");
    await writeFile(older, "old", "utf8");
    await writeFile(newer, "new", "utf8");
    await setMtime(older, new Date("2026-08-10T10:00:00Z"));
    await setMtime(newer, new Date("2026-08-12T10:00:00Z"));

    const result = await pickArchiveToUpload(archivedDir);
    if (result.kind !== "ok") throw new Error("expected ok");

    expect(result.chosen.name).toBe("processed_20260812.zip");
    expect(result.otherCount).toBe(1);
  });

  it("breaks an mtime tie deterministically by name descending", async () => {
    await mkdir(archivedDir);
    const a = path.join(archivedDir, "processed_20260810.zip");
    const b = path.join(archivedDir, "processed_20260811.zip");
    await writeFile(a, "a", "utf8");
    await writeFile(b, "b", "utf8");
    const sameMtime = new Date("2026-08-12T10:00:00Z");
    await setMtime(a, sameMtime);
    await setMtime(b, sameMtime);

    const result = await pickArchiveToUpload(archivedDir);
    if (result.kind !== "ok") throw new Error("expected ok");

    // "processed_20260811.zip" > "processed_20260810.zip" lexicographically.
    expect(result.chosen.name).toBe("processed_20260811.zip");
    expect(result.otherCount).toBe(1);
  });

  it("ignores non-matching files, dotfiles, .tmp files, subdirectories and symlinks", async () => {
    await mkdir(archivedDir);
    await writeFile(
      path.join(archivedDir, "processed_20260812.zip"),
      "zip",
      "utf8",
    );
    await writeFile(path.join(archivedDir, "readme.txt"), "x", "utf8");
    await writeFile(path.join(archivedDir, ".DS_Store"), "x", "utf8");
    await writeFile(path.join(archivedDir, "scratch.zip.tmp"), "x", "utf8");
    await mkdir(path.join(archivedDir, "subdir"));

    const result = await pickArchiveToUpload(archivedDir);
    if (result.kind !== "ok") throw new Error("expected ok");

    expect(result.chosen.name).toBe("processed_20260812.zip");
    expect(result.otherCount).toBe(0);
  });

  it("recognizes a prefixed-study zip name form too", async () => {
    await mkdir(archivedDir);
    await writeFile(
      path.join(archivedDir, "Car040962-2026-Pass3-A1_20260812.zip"),
      "zip",
      "utf8",
    );

    const result = await pickArchiveToUpload(archivedDir);
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.chosen.name).toBe("Car040962-2026-Pass3-A1_20260812.zip");
  });

  it("returns aborted when the signal is already aborted before stat-ing candidates", async () => {
    await mkdir(archivedDir);
    await writeFile(
      path.join(archivedDir, "processed_20260812.zip"),
      "zip",
      "utf8",
    );
    const controller = new AbortController();
    controller.abort();

    const result = await pickArchiveToUpload(archivedDir, controller.signal);
    expect(result).toEqual({ kind: "aborted" });
  });

  it("returns error with a raw fs code when archivedDir is not a directory", async () => {
    await writeFile(archivedDir, "not-a-dir", "utf8");
    const result = await pickArchiveToUpload(archivedDir);
    expect(result.kind).toBe("error");
  });
});
