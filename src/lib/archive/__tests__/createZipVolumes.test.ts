import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArchiveEntryStat } from "../planArchive.js";
import {
  cleanOrphanStagingDirs,
  createZipVolumes,
  type VolumeProgressEvent,
} from "../createZipVolumes.js";
import { readZip } from "./zipTestReader.js";
import { VERSION_NEEDED_DEFAULT } from "../zipFormat.js";

let tmpDir: string;
let sourceDir: string;
let uploadDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-test-zipvolumes-"));
  sourceDir = path.join(tmpDir, "processed");
  uploadDir = path.join(tmpDir, "upload");
  await mkdir(sourceDir, { recursive: true });
  delete process.env.CHIRO_MAX_VOLUME_BYTES;
});

afterEach(async () => {
  delete process.env.CHIRO_MAX_VOLUME_BYTES;
  await rm(tmpDir, { recursive: true, force: true });
});

/**
 * Deterministic, effectively-incompressible bytes (same technique as
 * `noZip64.test.ts`) — real WAV-like content would compress far below
 * `ENTRY_SIZE`, defeating the "exactly one entry per volume" property the
 * multi-volume fixture below relies on.
 */
const pseudoRandomBytes = (seed: number, length: number): Buffer => {
  const chunks: Buffer[] = [];
  let total = 0;
  let counter = 0;
  while (total < length) {
    const digest = createHash("sha256")
      .update(`zipvolumes-${seed.toString()}-${counter.toString()}`)
      .digest();
    chunks.push(digest);
    total += digest.length;
    counter++;
  }
  return Buffer.concat(chunks).subarray(0, length);
};

/**
 * Sized so that once `CHIRO_MAX_VOLUME_BYTES` is clamped down to its 1 MiB
 * floor (`MULTI_VOLUME_CAP` below — `maxVolumeBytes()` refuses anything
 * smaller), one entry always fits a volume alone but two never do (two raw
 * entries alone already exceed the cap, well before adding header/CD
 * overhead). Every volume built from this fixture ends up with exactly one
 * entry, making volume boundaries fully predictable — e.g. "volume 3" is
 * always `entries[2]`, with no timing race to get there.
 */
const ENTRY_SIZE = 600_000;
const MULTI_VOLUME_CAP = "1048576"; // 1 MiB — maxVolumeBytes()'s clamp floor

const buildEntries = async (count: number): Promise<ArchiveEntryStat[]> => {
  const entries: ArchiveEntryStat[] = [];
  for (let i = 0; i < count; i++) {
    const name = `e${i.toString().padStart(3, "0")}.wav`;
    const content = pseudoRandomBytes(i, ENTRY_SIZE);
    const abs = path.join(sourceDir, name);
    await writeFile(abs, content);
    const stats = await stat(abs);
    entries.push({ name, size: stats.size, mtime: stats.mtime });
  }
  return entries;
};

describe("createZipVolumes — nominal", () => {
  it("splits into one volume per entry, publishes a series dir, cleans up staging", async () => {
    process.env.CHIRO_MAX_VOLUME_BYTES = MULTI_VOLUME_CAP;
    const entries = await buildEntries(5);

    const result = await createZipVolumes({
      sourceDir,
      entries,
      uploadDir,
      seriesDirName: "depot_20260814",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("type narrowing");
    expect(result.volumes).toHaveLength(5);
    expect(result.entryCount).toBe(5);
    expect(result.seriesDirName).toBe("depot_20260814");
    expect(typeof result.durable).toBe("boolean");

    // Staging is gone: upload/ contains only the published series dir.
    expect(await readdir(uploadDir)).toEqual(["depot_20260814"]);

    const seriesFiles = (await readdir(result.seriesDirPath)).sort();
    expect(seriesFiles).toEqual(
      [...result.volumes.map((v) => v.fileName)].sort(),
    );
    // No `part` suffix confusion: names follow buildVolumeFileName exactly,
    // zero-padding never kicks in below 10 volumes.
    expect(seriesFiles).toEqual([
      "depot_20260814_part1.zip",
      "depot_20260814_part2.zip",
      "depot_20260814_part3.zip",
      "depot_20260814_part4.zip",
      "depot_20260814_part5.zip",
    ]);

    // Union of entries across the whole series = the source set exactly,
    // in original (alphabetical) order — and every entry's inflated data is
    // byte-identical to its source.
    const allNames: string[] = [];
    for (const volume of result.volumes) {
      const parsed = await readZip(
        path.join(result.seriesDirPath, volume.fileName),
      );
      expect(parsed.entries).toHaveLength(1);
      for (const entry of parsed.entries) {
        allNames.push(entry.name);
        expect(entry.versionNeeded).toBe(VERSION_NEEDED_DEFAULT);
        const srcBuf = await readFile(path.join(sourceDir, entry.name));
        expect(entry.data.equals(srcBuf)).toBe(true);
      }
    }
    expect(allNames).toEqual(entries.map((e) => e.name));

    // Non-destructivité: processed/ is untouched.
    expect((await readdir(sourceDir)).sort()).toEqual(
      [...entries.map((e) => e.name)].sort(),
    );
  });

  it("N=1: a single volume gets no part suffix at all", async () => {
    const entries = await buildEntries(1);

    const result = await createZipVolumes({
      sourceDir,
      entries,
      uploadDir,
      seriesDirName: "depot_20260814",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("type narrowing");
    expect(result.volumes).toHaveLength(1);
    expect(result.volumes[0]?.fileName).toBe("depot_20260814.zip");
  });
});

describe("createZipVolumes — atomicity", () => {
  it("aborting mid-series leaves upload/ empty and processed/ untouched", async () => {
    process.env.CHIRO_MAX_VOLUME_BYTES = MULTI_VOLUME_CAP;
    const entries = await buildEntries(5);
    const controller = new AbortController();

    const result = await createZipVolumes({
      sourceDir,
      entries,
      uploadDir,
      seriesDirName: "depot_20260814",
      signal: controller.signal,
      onProgress: (event) => {
        if (event.kind === "volume-start" && event.volumeIndex === 3) {
          controller.abort();
        }
      },
    });

    expect(result.kind).toBe("aborted");
    expect(await readdir(uploadDir)).toEqual([]);
    expect((await readdir(sourceDir)).sort()).toEqual(
      [...entries.map((e) => e.name)].sort(),
    );
  });

  it("a source file deleted before the run leaves upload/ empty (rest of processed/ untouched)", async () => {
    process.env.CHIRO_MAX_VOLUME_BYTES = MULTI_VOLUME_CAP;
    const entries = await buildEntries(5);
    const targetName = entries[2]?.name;
    if (targetName === undefined) throw new Error("fixture error");

    // Deleted up front rather than mid-run via a progress-event hook: with
    // exactly one entry per volume (by fixture construction), entries[2] is
    // deterministically what volume 3 reads — no timing race needed to hit
    // it. `createZipArchive`'s per-entry `stat()` re-check turns this into
    // `file-changed` as soon as volume 3 gets to it.
    await rm(path.join(sourceDir, targetName));

    const result = await createZipVolumes({
      sourceDir,
      entries,
      uploadDir,
      seriesDirName: "depot_20260814",
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.code).toBe("file-changed");
    expect(await readdir(uploadDir)).toEqual([]);

    const remaining = (await readdir(sourceDir)).sort();
    expect(remaining).toEqual(
      [...entries.map((e) => e.name)].filter((n) => n !== targetName).sort(),
    );
  });
});

describe("createZipVolumes — zip64 forbid wiring", () => {
  it("forwards zip64Thresholds and fails the whole series with zip64-required, upload/ left empty", async () => {
    const entries = await buildEntries(1);

    const result = await createZipVolumes({
      sourceDir,
      entries,
      uploadDir,
      seriesDirName: "depot_20260814",
      zip64Thresholds: { offset: 64 },
    });

    expect(result).toEqual({ kind: "error", code: "zip64-required" });
    expect(await readdir(uploadDir)).toEqual([]);
  });
});

describe("createZipVolumes — commit collision", () => {
  it("suffixes the series dir with -2 when the name is already taken", async () => {
    await mkdir(uploadDir, { recursive: true });
    const existingDir = path.join(uploadDir, "depot_20260814");
    await mkdir(existingDir);
    await writeFile(path.join(existingDir, "unrelated.txt"), "not ours");

    const entries = await buildEntries(1);
    const result = await createZipVolumes({
      sourceDir,
      entries,
      uploadDir,
      seriesDirName: "depot_20260814",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("type narrowing");
    expect(result.seriesDirName).toBe("depot_20260814-2");

    const uploadEntries = await readdir(uploadDir);
    expect(uploadEntries).toHaveLength(2);
    expect(uploadEntries).toEqual(
      expect.arrayContaining(["depot_20260814", "depot_20260814-2"]),
    );
    // The pre-existing dir is left completely untouched.
    expect(await readdir(existingDir)).toEqual(["unrelated.txt"]);
  });
});

describe("createZipVolumes — progress re-offsetting", () => {
  it("emits globally monotonic entryIndex, one volume-start per volume, and a final bytes-read equal to the total", async () => {
    process.env.CHIRO_MAX_VOLUME_BYTES = MULTI_VOLUME_CAP;
    const entries = await buildEntries(5);
    const events: VolumeProgressEvent[] = [];

    const result = await createZipVolumes({
      sourceDir,
      entries,
      uploadDir,
      seriesDirName: "depot_20260814",
      onProgress: (event) => {
        events.push(event);
      },
    });

    expect(result.kind).toBe("ok");

    const volumeStartIndices: number[] = [];
    const entryIndices: number[] = [];
    const bytesReadValues: number[] = [];
    for (const event of events) {
      if (event.kind === "volume-start") {
        volumeStartIndices.push(event.volumeIndex);
      } else if (event.kind === "entry-start" || event.kind === "entry-done") {
        entryIndices.push(event.entryIndex);
      } else if (event.kind === "bytes-read") {
        bytesReadValues.push(event.totalBytesRead);
      }
    }

    expect(volumeStartIndices).toEqual([1, 2, 3, 4, 5]);
    expect(entryIndices).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(bytesReadValues.at(-1)).toBe(entries.length * ENTRY_SIZE);
  });
});

describe("cleanOrphanStagingDirs", () => {
  it("does nothing when uploadDir doesn't exist yet (no throw)", async () => {
    await expect(
      cleanOrphanStagingDirs(path.join(tmpDir, "does-not-exist")),
    ).resolves.toBeUndefined();
  });

  it("leaves non-matching entries alone", async () => {
    await mkdir(uploadDir, { recursive: true });
    await mkdir(path.join(uploadDir, "depot_20260814")); // a published series
    await writeFile(path.join(uploadDir, "notes.txt"), "content");
    await cleanOrphanStagingDirs(uploadDir);
    expect((await readdir(uploadDir)).sort()).toEqual([
      "depot_20260814",
      "notes.txt",
    ]);
  });

  it("leaves a staging dir alone when its embedded PID is still alive (this process)", async () => {
    await mkdir(uploadDir, { recursive: true });
    const name = `.depot_20260814.${process.pid.toString()}.tmpdir`;
    const dirPath = path.join(uploadDir, name);
    await mkdir(dirPath);
    await writeFile(path.join(dirPath, "depot_20260814_part1.zip"), "x");

    await cleanOrphanStagingDirs(uploadDir);

    expect(await readdir(uploadDir)).toEqual([name]);
  });

  it("removes a staging dir whose embedded PID no longer corresponds to a running process", async () => {
    await mkdir(uploadDir, { recursive: true });

    // Spawn and wait for a genuinely dead process to get a real, now-unused PID.
    const { spawn } = await import("node:child_process");
    const deadPid: number = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
      const pid = child.pid;
      child.on("exit", () => {
        if (pid === undefined) reject(new Error("no pid"));
        else resolve(pid);
      });
      child.on("error", reject);
    });

    const name = `.depot_20260814.${deadPid.toString()}.tmpdir`;
    const dirPath = path.join(uploadDir, name);
    await mkdir(dirPath);
    await writeFile(path.join(dirPath, "depot_20260814_part1.zip"), "x");

    await cleanOrphanStagingDirs(uploadDir);

    expect(await readdir(uploadDir)).toEqual([]);
  });

  it("removes a staging dir whose PID is alive but mtime is older than 24h", async () => {
    await mkdir(uploadDir, { recursive: true });
    const name = `.depot_20260814.${process.pid.toString()}.tmpdir`;
    const dirPath = path.join(uploadDir, name);
    await mkdir(dirPath);
    await writeFile(path.join(dirPath, "depot_20260814_part1.zip"), "x");

    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(dirPath, old, old);

    await cleanOrphanStagingDirs(uploadDir);

    expect(await readdir(uploadDir)).toEqual([]);
  });

  it("never follows a symlink even if its name matches the orphan pattern", async () => {
    await mkdir(uploadDir, { recursive: true });
    const realDir = path.join(tmpDir, "real-target");
    await mkdir(realDir);
    await writeFile(path.join(realDir, "keep.txt"), "keep me");
    const linkName = ".depot_20260814.999999999.tmpdir";
    await symlink(realDir, path.join(uploadDir, linkName));

    await cleanOrphanStagingDirs(uploadDir);

    expect(await readdir(realDir)).toEqual(["keep.txt"]);
  });

  it("gives up (leaves the dir in place) when unexpected content blocks rmdir", async () => {
    await mkdir(uploadDir, { recursive: true });

    const { spawn } = await import("node:child_process");
    const deadPid: number = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
      const pid = child.pid;
      child.on("exit", () => {
        if (pid === undefined) reject(new Error("no pid"));
        else resolve(pid);
      });
      child.on("error", reject);
    });

    const name = `.depot_20260814.${deadPid.toString()}.tmpdir`;
    const dirPath = path.join(uploadDir, name);
    await mkdir(dirPath);
    // A subdirectory is not a name this module ever creates inside staging
    // — left alone, so rmdir fails ENOTEMPTY and the whole thing is left in
    // place rather than force-deleted.
    await mkdir(path.join(dirPath, "unexpected-subdir"));

    await cleanOrphanStagingDirs(uploadDir);

    expect(await readdir(uploadDir)).toEqual([name]);
    expect(await readdir(dirPath)).toEqual(["unexpected-subdir"]);
  });
});
