import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArchiveEntryStat } from "../planArchive.js";
import { createZipArchive } from "../createZipArchive.js";
import { readZip } from "./zipTestReader.js";
import { VERSION_NEEDED_DEFAULT, VERSION_NEEDED_ZIP64 } from "../zipFormat.js";

let tmpDir: string;
let sourceDir: string;
let archivedDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-test-zip64-"));
  sourceDir = path.join(tmpDir, "processed");
  archivedDir = path.join(tmpDir, "archived");
  await mkdir(sourceDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const findBin = (name: string): string | null => {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

const UNZIP_BIN = findBin("unzip");

describe("createZipArchive — injected ZIP64 offset threshold, end to end", () => {
  it("writes a ZIP64 extra field + EOCD64 + locator once the offset threshold is crossed, and the archive still reads back correctly", async () => {
    const entries: ArchiveEntryStat[] = [];
    for (const name of ["a.wav", "b.wav", "c.wav"]) {
      const abs = path.join(sourceDir, name);
      await writeFile(abs, `content of ${name}`);
      const stats = await stat(abs);
      entries.push({ name, size: stats.size, mtime: stats.mtime });
    }
    const zipPath = path.join(archivedDir, "processed_zip64.zip");

    const result = await createZipArchive({
      sourceDir,
      entries,
      zipPath,
      zip64Thresholds: { offset: 64 },
    });
    expect(result.kind).toBe("ok");

    const parsed = await readZip(zipPath);
    expect(parsed.entries).toHaveLength(3);

    // The first entry sits at offset 0 (below 64) → plain offset, v20.
    // Later entries sit above 64 → ZIP64 extra field, v45.
    const first = parsed.entries.find((e) => e.localHeaderOffset < 64);
    const later = parsed.entries.filter((e) => e.localHeaderOffset >= 64);
    expect(first?.versionNeeded).toBe(VERSION_NEEDED_DEFAULT);
    expect(later.length).toBeGreaterThan(0);
    for (const e of later) {
      expect(e.versionNeeded).toBe(VERSION_NEEDED_ZIP64);
    }

    for (const entry of entries) {
      const found = parsed.entries.find((e) => e.name === entry.name);
      expect(found?.data.toString("utf8")).toBe(`content of ${entry.name}`);
    }

    if (UNZIP_BIN) {
      const proc = spawnSync(UNZIP_BIN, ["-tqq", zipPath], {
        maxBuffer: 10 * 1024 * 1024,
      });
      expect(proc.status).toBe(0);
    }
  });

  it("writes a ZIP64 EOCD + locator once the entry count threshold is crossed", async () => {
    const entries: ArchiveEntryStat[] = [];
    for (let i = 0; i < 5; i++) {
      const name = `f${i.toString()}.wav`;
      const abs = path.join(sourceDir, name);
      await writeFile(abs, `payload ${i.toString()}`);
      const stats = await stat(abs);
      entries.push({ name, size: stats.size, mtime: stats.mtime });
    }
    const zipPath = path.join(archivedDir, "processed_zip64count.zip");

    const result = await createZipArchive({
      sourceDir,
      entries,
      zipPath,
      zip64Thresholds: { entryCount: 3 },
    });
    expect(result.kind).toBe("ok");

    const parsed = await readZip(zipPath);
    expect(parsed.entryCount).toBe(5);
    expect(parsed.entries).toHaveLength(5);

    if (UNZIP_BIN) {
      const proc = spawnSync(UNZIP_BIN, ["-tqq", zipPath], {
        maxBuffer: 10 * 1024 * 1024,
      });
      expect(proc.status).toBe(0);
    }
  });
});

const tmpFilesIn = async (dir: string): Promise<string[]> => {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".tmp"));
  } catch {
    return [];
  }
};

describe("createZipArchive — zip64: forbid", () => {
  it("fails with zip64-required when an injected offset threshold would be crossed, leaving no .tmp and no zip", async () => {
    const entries: ArchiveEntryStat[] = [];
    for (const name of ["a.wav", "b.wav", "c.wav"]) {
      const abs = path.join(sourceDir, name);
      await writeFile(abs, `content of ${name}`);
      const stats = await stat(abs);
      entries.push({ name, size: stats.size, mtime: stats.mtime });
    }
    const zipPath = path.join(archivedDir, "processed_forbidoffset.zip");

    const result = await createZipArchive({
      sourceDir,
      entries,
      zipPath,
      zip64: "forbid",
      zip64Thresholds: { offset: 64 },
    });

    expect(result).toEqual({ kind: "error", code: "zip64-required" });
    await expect(stat(zipPath)).rejects.toThrow();
    expect(await tmpFilesIn(archivedDir)).toEqual([]);
  });

  it("fails with zip64-required via the entry-count guard, which the per-entry offset guard can never see", async () => {
    const entries: ArchiveEntryStat[] = [];
    for (let i = 0; i < 4; i++) {
      const name = `f${i.toString()}.wav`;
      const abs = path.join(sourceDir, name);
      await writeFile(abs, `payload ${i.toString()}`);
      const stats = await stat(abs);
      entries.push({ name, size: stats.size, mtime: stats.mtime });
    }
    const zipPath = path.join(archivedDir, "processed_forbidcount.zip");

    const result = await createZipArchive({
      sourceDir,
      entries,
      zipPath,
      zip64: "forbid",
      zip64Thresholds: { entryCount: 3 },
    });

    expect(result).toEqual({ kind: "error", code: "zip64-required" });
    await expect(stat(zipPath)).rejects.toThrow();
    expect(await tmpFilesIn(archivedDir)).toEqual([]);
  });

  it("splits into multiple volumes under maxBytes instead of failing guard 0 against the whole remaining entry pool", async () => {
    // Reviewer repro: 10 entries, entryCountThreshold: 4, maxBytes small
    // enough that each volume only ever holds ~2 entries. Guard 0 must not
    // see `opts.entries.length` (10, the whole remaining pool handed to
    // every volume) and fail immediately — each volume's own entry count
    // stays well under the threshold.
    const entries: ArchiveEntryStat[] = [];
    for (let i = 0; i < 10; i++) {
      const name = `f${i.toString()}.wav`;
      const abs = path.join(sourceDir, name);
      await writeFile(abs, `x${i.toString()}`);
      const stats = await stat(abs);
      entries.push({ name, size: stats.size, mtime: stats.mtime });
    }

    let remaining: ArchiveEntryStat[] = entries;
    let volumeIndex = 1;
    const maxEntryCountSeen: number[] = [];

    for (;;) {
      const zipPath = path.join(
        archivedDir,
        `processed_forbidmaxbytes_vol${volumeIndex.toString()}.zip`,
      );
      const result = await createZipArchive({
        sourceDir,
        entries: remaining,
        zipPath,
        zip64: "forbid",
        zip64Thresholds: { entryCount: 4 },
        maxBytes: 1500,
      });

      expect(result.kind).not.toBe("error");
      if (result.kind === "error") {
        throw new Error(`unexpected error: ${result.code}`);
      }
      if (result.kind === "ok") {
        maxEntryCountSeen.push(result.entryCount);
        break;
      }
      if (result.kind !== "volume-full") {
        throw new Error(`unexpected result: ${JSON.stringify(result)}`);
      }
      maxEntryCountSeen.push(result.entryCount);
      remaining = remaining.slice(result.entriesWritten);
      volumeIndex++;
    }

    expect(volumeIndex).toBeGreaterThan(1);
    for (const count of maxEntryCountSeen) {
      expect(count).toBeLessThan(4);
    }
  });

  it("is a no-op when nothing would actually trigger ZIP64", async () => {
    const entries: ArchiveEntryStat[] = [];
    for (const name of ["a.wav", "b.wav"]) {
      const abs = path.join(sourceDir, name);
      await writeFile(abs, `content of ${name}`);
      const stats = await stat(abs);
      entries.push({ name, size: stats.size, mtime: stats.mtime });
    }
    const zipPath = path.join(archivedDir, "processed_forbidnoop.zip");

    const result = await createZipArchive({
      sourceDir,
      entries,
      zipPath,
      zip64: "forbid",
    });

    expect(result.kind).toBe("ok");
  });
});

const SLOW_TEST_ENV = "CHIRO_SLOW_TESTS";

describe("createZipArchive — many entries", () => {
  it("handles 100 entries through an injected low entryCount threshold (stand-in for the 65 536-entry ZIP64 boundary)", async () => {
    const entries: ArchiveEntryStat[] = [];
    for (let i = 0; i < 100; i++) {
      const name = `e${i.toString().padStart(4, "0")}.wav`;
      const abs = path.join(sourceDir, name);
      await writeFile(abs, `x${i.toString()}`);
      const stats = await stat(abs);
      entries.push({ name, size: stats.size, mtime: stats.mtime });
    }
    const zipPath = path.join(archivedDir, "processed_many.zip");

    const result = await createZipArchive({
      sourceDir,
      entries,
      zipPath,
      zip64Thresholds: { entryCount: 50 },
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("type narrowing");
    expect(result.entryCount).toBe(100);

    const parsed = await readZip(zipPath);
    expect(parsed.entryCount).toBe(100);
    expect(parsed.entries).toHaveLength(100);
  });

  // Real 65 536+ entries, exercising the actual MAX_UINT16 boundary rather
  // than an injected stand-in threshold. Writing 70 000 files costs ~40 s, so
  // it is opt-in via CHIRO_SLOW_TESTS=1 and runs in NO automated pipeline
  // today — the boundary *logic* is covered on every run by the injected
  // `entryCount` threshold above; only the real 65 535 crossing needs this.
  it.skipIf(!process.env[SLOW_TEST_ENV])(
    "handles 70 000 real entries at the actual ZIP64 entry-count boundary",
    async () => {
      const entries: ArchiveEntryStat[] = [];
      const count = 70_000;
      for (let i = 0; i < count; i++) {
        const name = `e${i.toString().padStart(6, "0")}.wav`;
        const abs = path.join(sourceDir, name);
        await writeFile(abs, `x${i.toString()}`);
        const stats = await stat(abs);
        entries.push({ name, size: stats.size, mtime: stats.mtime });
      }
      const zipPath = path.join(archivedDir, "processed_70k.zip");

      const result = await createZipArchive({ sourceDir, entries, zipPath });
      expect(result.kind).toBe("ok");
      if (result.kind !== "ok") throw new Error("type narrowing");
      expect(result.entryCount).toBe(count);

      const parsed = await readZip(zipPath);
      expect(parsed.entryCount).toBe(count);
      expect(parsed.entries).toHaveLength(count);
      expect(
        parsed.entries.every((e) => e.versionNeeded >= VERSION_NEEDED_DEFAULT),
      ).toBe(true);

      if (UNZIP_BIN) {
        const proc = spawnSync(UNZIP_BIN, ["-tqq", zipPath], {
          maxBuffer: 10 * 1024 * 1024,
        });
        expect(proc.status).toBe(0);
      }
    },
    120_000,
  );
});
