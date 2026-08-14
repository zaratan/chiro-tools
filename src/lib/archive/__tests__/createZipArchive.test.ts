import {
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildArchiveName,
  resolveArchiveFileName,
  type ArchiveEntryStat,
} from "../planArchive.js";
import {
  cleanOrphanArchiveTmp,
  createZipArchive,
  type ArchiveProgressEvent,
} from "../createZipArchive.js";
import { readZip } from "./zipTestReader.js";

let tmpDir: string;
let sourceDir: string;
let archivedDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-test-zip-"));
  sourceDir = path.join(tmpDir, "processed");
  archivedDir = path.join(tmpDir, "archived");
  await mkdir(sourceDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const writeSourceFile = async (
  name: string,
  content: Buffer | string,
): Promise<ArchiveEntryStat> => {
  const abs = path.join(sourceDir, name);
  await writeFile(abs, content);
  const stats = await stat(abs);
  return { name, size: stats.size, mtime: stats.mtime };
};

const tmpFilesIn = async (dir: string): Promise<string[]> => {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".tmp"));
  } catch {
    return [];
  }
};

describe("createZipArchive — nominal round trip", () => {
  it("produces a ZIP whose inflated entries match the sources byte-for-byte", async () => {
    const entries = [
      await writeSourceFile("a_001.wav", "hello world".repeat(1000)),
      await writeSourceFile("b_002.wav", Buffer.from([1, 2, 3, 4, 5])),
      await writeSourceFile("c_003.wav", "some other content, deflatable"),
    ];
    const zipPath = path.join(archivedDir, "processed_test.zip");

    const result = await createZipArchive({ sourceDir, entries, zipPath });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("type narrowing");
    expect(result.entryCount).toBe(3);
    expect(result.zipPath).toBe(zipPath);

    const parsed = await readZip(zipPath);
    expect(parsed.entryCount).toBe(3);
    for (const entry of entries) {
      const found = parsed.entries.find((e) => e.name === entry.name);
      expect(found).toBeDefined();
      const srcBuf = await readFile(path.join(sourceDir, entry.name));
      expect(found?.data.equals(srcBuf)).toBe(true);
    }

    // Source untouched — non-destructive invariant.
    for (const entry of entries) {
      await expect(
        stat(path.join(sourceDir, entry.name)),
      ).resolves.toBeDefined();
    }

    // No leftover .tmp in archivedDir.
    expect(await tmpFilesIn(archivedDir)).toEqual([]);
  });

  it("handles a zero-byte source file", async () => {
    const entries = [await writeSourceFile("empty.wav", "")];
    const zipPath = path.join(archivedDir, "processed_empty.zip");

    const result = await createZipArchive({ sourceDir, entries, zipPath });
    expect(result.kind).toBe("ok");

    const parsed = await readZip(zipPath);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.data.length).toBe(0);
  });

  it("round-trips an accented file name in NFC form", async () => {
    const name = "Car000001-2026-Pass1-ÉTANG.wav"; // NFC "É"
    const entries = [await writeSourceFile(name, "chauve-souris")];
    const zipPath = path.join(archivedDir, "processed_nfc.zip");

    const result = await createZipArchive({ sourceDir, entries, zipPath });
    expect(result.kind).toBe("ok");

    const parsed = await readZip(zipPath);
    expect(parsed.entries[0]?.name).toBe(name);
  });

  it("round-trips an accented file name in NFD form (macOS/APFS on-disk form)", async () => {
    const name = "Car000001-2026-Pass1-ÉTANG.wav"; // NFD "E" + combining acute
    const entries = [await writeSourceFile(name, "chauve-souris")];
    const zipPath = path.join(archivedDir, "processed_nfd.zip");

    const result = await createZipArchive({ sourceDir, entries, zipPath });
    expect(result.kind).toBe("ok");

    const parsed = await readZip(zipPath);
    expect(parsed.entries[0]?.name).toBe(name);
  });

  it("creates the archived/ directory when it doesn't exist yet", async () => {
    const entries = [await writeSourceFile("a.wav", "content")];
    const zipPath = path.join(archivedDir, "processed_mkdir.zip");

    await expect(stat(archivedDir)).rejects.toThrow();
    const result = await createZipArchive({ sourceDir, entries, zipPath });
    expect(result.kind).toBe("ok");
    await expect(stat(archivedDir)).resolves.toBeDefined();
  });
});

describe("createZipArchive — same-minute name collision, end to end", () => {
  it("resolves a -2 suffix and creates a second, independently readable zip alongside the first", async () => {
    const entries = [
      await writeSourceFile("a.wav", "first archive content"),
      await writeSourceFile("b.wav", "second file in the first archive"),
    ];

    const baseName = buildArchiveName(new Date());

    const firstResolved = await resolveArchiveFileName(archivedDir, baseName);
    if (firstResolved.kind !== "ok") throw new Error("type narrowing");
    expect(firstResolved.fileName).toBe(baseName);
    const firstZipPath = path.join(archivedDir, firstResolved.fileName);

    const firstResult = await createZipArchive({
      sourceDir,
      entries,
      zipPath: firstZipPath,
    });
    expect(firstResult.kind).toBe("ok");

    // Same baseName, resolved again against the now-occupied archivedDir.
    const secondResolved = await resolveArchiveFileName(archivedDir, baseName);
    if (secondResolved.kind !== "ok") throw new Error("type narrowing");
    expect(secondResolved.fileName).toBe(baseName.replace(/\.zip$/, "-2.zip"));
    const secondZipPath = path.join(archivedDir, secondResolved.fileName);

    const secondResult = await createZipArchive({
      sourceDir,
      entries,
      zipPath: secondZipPath,
    });
    expect(secondResult.kind).toBe("ok");

    // Both files exist on disk, side by side.
    await expect(stat(firstZipPath)).resolves.toBeDefined();
    await expect(stat(secondZipPath)).resolves.toBeDefined();
    expect(firstZipPath).not.toBe(secondZipPath);

    // Both are independently readable and hold the correct entries.
    for (const zipPath of [firstZipPath, secondZipPath]) {
      const parsed = await readZip(zipPath);
      expect(parsed.entryCount).toBe(2);
      for (const entry of entries) {
        const found = parsed.entries.find((e) => e.name === entry.name);
        expect(found).toBeDefined();
        const srcBuf = await readFile(path.join(sourceDir, entry.name));
        expect(found?.data.equals(srcBuf)).toBe(true);
      }
    }
  });
});

describe("createZipArchive — progress events", () => {
  it("emits entry-start, bytes-read (cumulative), and entry-done per entry, in order", async () => {
    const entries = [
      await writeSourceFile("a.wav", "x".repeat(2 * 1024 * 1024)),
      await writeSourceFile("b.wav", "y".repeat(512)),
    ];
    const zipPath = path.join(archivedDir, "processed_progress.zip");

    const events: ArchiveProgressEvent[] = [];
    const result = await createZipArchive({
      sourceDir,
      entries,
      zipPath,
      onProgress: (e) => events.push(e),
    });
    expect(result.kind).toBe("ok");

    const starts = events.filter((e) => e.kind === "entry-start");
    const dones = events.filter((e) => e.kind === "entry-done");
    const byteReads = events.filter((e) => e.kind === "bytes-read");

    expect(starts).toHaveLength(2);
    expect(dones).toHaveLength(2);
    expect(byteReads.length).toBeGreaterThan(0);

    // First event is entry-start of entry 0, last is entry-done of entry 1.
    expect(events[0]).toEqual({
      kind: "entry-start",
      entryIndex: 0,
      entryName: "a.wav",
      totalEntries: 2,
    });
    expect(events[events.length - 1]).toEqual({
      kind: "entry-done",
      entryIndex: 1,
    });

    // Cumulative totalBytesRead is monotonically non-decreasing and ends at
    // the sum of source sizes.
    let previous = 0;
    for (const e of byteReads) {
      if (e.kind !== "bytes-read") continue;
      expect(e.totalBytesRead).toBeGreaterThanOrEqual(previous);
      previous = e.totalBytesRead;
    }
    const totalSourceBytes = entries.reduce((sum, e) => sum + e.size, 0);
    expect(previous).toBe(totalSourceBytes);
  });

  it("does not crash the batch when onProgress throws", async () => {
    const entries = [await writeSourceFile("a.wav", "content")];
    const zipPath = path.join(archivedDir, "processed_buggy_progress.zip");

    const result = await createZipArchive({
      sourceDir,
      entries,
      zipPath,
      onProgress: () => {
        throw new Error("buggy callback");
      },
    });
    expect(result.kind).toBe("ok");
  });
});

describe("createZipArchive — abort", () => {
  it("returns aborted and leaves no .tmp residual and no zip when aborted before starting", async () => {
    const entries = [await writeSourceFile("a.wav", "content")];
    const zipPath = path.join(archivedDir, "processed_preaborted.zip");

    const controller = new AbortController();
    controller.abort();

    const result = await createZipArchive({
      sourceDir,
      entries,
      zipPath,
      signal: controller.signal,
    });
    expect(result).toEqual({ kind: "aborted" });
    await expect(stat(zipPath)).rejects.toThrow();
  });

  it("returns aborted and leaves no .tmp residual when aborted mid-stream", async () => {
    const entries = [
      await writeSourceFile("a.wav", "x".repeat(3 * 1024 * 1024)),
      await writeSourceFile("b.wav", "y".repeat(3 * 1024 * 1024)),
    ];
    const zipPath = path.join(archivedDir, "processed_midabort.zip");

    const controller = new AbortController();
    let aborted = false;
    const result = await createZipArchive({
      sourceDir,
      entries,
      zipPath,
      signal: controller.signal,
      onProgress: (e) => {
        if (e.kind === "bytes-read" && !aborted) {
          aborted = true;
          controller.abort();
        }
      },
    });

    expect(result).toEqual({ kind: "aborted" });
    await expect(stat(zipPath)).rejects.toThrow();
    expect(await tmpFilesIn(archivedDir)).toEqual([]);
  });

  it("returns aborted between entries, before the next one is even opened", async () => {
    const entries = [
      await writeSourceFile("a.wav", "content a"),
      await writeSourceFile("b.wav", "content b"),
    ];
    const zipPath = path.join(archivedDir, "processed_interentryabort.zip");

    const controller = new AbortController();
    const startedEntries: string[] = [];
    const result = await createZipArchive({
      sourceDir,
      entries,
      zipPath,
      signal: controller.signal,
      onProgress: (e) => {
        if (e.kind === "entry-start") startedEntries.push(e.entryName);
        if (e.kind === "entry-done") controller.abort();
      },
    });

    expect(result).toEqual({ kind: "aborted" });
    expect(startedEntries).toEqual(["a.wav"]); // entry b.wav never started
    expect(await tmpFilesIn(archivedDir)).toEqual([]);
  });
});

describe("createZipArchive — file-changed", () => {
  it("fails with file-changed and cleans up the .tmp when a source is resized after admission", async () => {
    const entry = await writeSourceFile("a.wav", "original content");
    const zipPath = path.join(archivedDir, "processed_filechanged.zip");

    // Mutate the source AFTER the plan entry was built, so its recorded
    // `size` no longer matches what's on disk when createZipArchive re-stats.
    await writeFile(
      path.join(sourceDir, "a.wav"),
      "a completely different, longer payload",
    );

    const result = await createZipArchive({
      sourceDir,
      entries: [entry],
      zipPath,
    });
    expect(result).toEqual({ kind: "error", code: "file-changed" });
    await expect(stat(zipPath)).rejects.toThrow();
    expect(await tmpFilesIn(archivedDir)).toEqual([]);
  });

  it("fails with file-changed when a planned source has disappeared", async () => {
    const entry = await writeSourceFile("a.wav", "content");
    const zipPath = path.join(archivedDir, "processed_missing.zip");

    await rm(path.join(sourceDir, "a.wav"));

    const result = await createZipArchive({
      sourceDir,
      entries: [entry],
      zipPath,
    });
    expect(result).toEqual({ kind: "error", code: "file-changed" });
    expect(await tmpFilesIn(archivedDir)).toEqual([]);
  });

  it("fails with file-changed when a source is truncated mid-read, after the pre-open re-stat already passed", async () => {
    const name = "a.wav";
    await writeFile(path.join(sourceDir, name), "x".repeat(3 * 1024 * 1024));
    const fullStats = await stat(path.join(sourceDir, name));
    const entry: ArchiveEntryStat = {
      name,
      size: fullStats.size,
      mtime: fullStats.mtime,
    };
    const zipPath = path.join(archivedDir, "processed_midtruncate.zip");

    let truncated = false;
    const result = await createZipArchive({
      sourceDir,
      entries: [entry],
      zipPath,
      onProgress: (e) => {
        if (e.kind === "bytes-read" && !truncated) {
          truncated = true;
          // Deliberately fire-and-forget: this must land *during* the
          // ongoing read loop, so it can't be awaited from inside the
          // synchronous onProgress callback without deadlocking it.
          void writeFile(path.join(sourceDir, name), "short now");
        }
      },
    });

    expect(result).toEqual({ kind: "error", code: "file-changed" });
    expect(await tmpFilesIn(archivedDir)).toEqual([]);
  });
});

describe("createZipArchive — verify-failed", () => {
  it("discards the archive and reports verify-failed when the .tmp is corrupted before verify", async () => {
    const entries = [await writeSourceFile("a.wav", "content".repeat(100))];
    const zipPath = path.join(archivedDir, "processed_corrupt.zip");

    const result = await createZipArchive({
      sourceDir,
      entries,
      zipPath,
      corruptBeforeVerifyForTests: async (tmpPath) => {
        // Flip a byte inside the first entry's compressed data — corrupts
        // the deflate stream without touching any header/signature.
        const fh = await open(tmpPath, "r+");
        try {
          const buf = Buffer.alloc(1);
          await fh.read(buf, 0, 1, 40);
          buf[0] = (buf[0] ?? 0) ^ 0xff;
          await fh.write(buf, 0, 1, 40);
        } finally {
          await fh.close();
        }
      },
    });

    expect(result).toEqual({ kind: "error", code: "verify-failed" });
    await expect(stat(zipPath)).rejects.toThrow();
    expect(await tmpFilesIn(archivedDir)).toEqual([]);
  });
});

describe("createZipArchive — entry-too-large admission", () => {
  it("rejects an entry whose freshly-stat'd size reaches the 32-bit boundary", async () => {
    // Building an actual 4 GiB fixture is impractical in CI — this exercises
    // the admission guard directly via a plan entry whose declared size sits
    // at the boundary, independent from the real on-disk size (the guard
    // reads the fresh stat, not the plan's `size`, but the file itself only
    // needs to be non-empty for the open() to succeed before the guard hits).
    // A sparse file is used to reach the real boundary without writing 4 GiB.
    const name = "huge.wav";
    const abs = path.join(sourceDir, name);
    const fh = await open(abs, "w");
    await fh.truncate(0xffffffff);
    await fh.close();

    const stats = await stat(abs);
    const entries: ArchiveEntryStat[] = [
      { name, size: stats.size, mtime: stats.mtime },
    ];
    const zipPath = path.join(archivedDir, "processed_huge.zip");

    const result = await createZipArchive({ sourceDir, entries, zipPath });
    expect(result).toEqual({ kind: "error", code: "entry-too-large" });
  }, 30_000);
});

describe("createZipArchive — overload resolution", () => {
  it("accepts a spread options object whose maxBytes is a `number | undefined` variable, not a literal", async () => {
    // Neither overload structurally matched `{ ...base, maxBytes: cap }` when
    // `cap` is a plain `number | undefined` variable — this is exactly the
    // shape the 9.B orchestrator builds. This call exists to make
    // `tsc --noEmit` exercise the overload; a type regression here fails
    // `pnpm check`, not this assertion.
    const entries = [await writeSourceFile("overload.wav", "content")];
    const base = {
      sourceDir,
      entries,
      zipPath: path.join(archivedDir, "processed_overload.zip"),
    };
    const cap: number | undefined = undefined;

    const result = await createZipArchive({ ...base, maxBytes: cap });
    expect(result.kind).toBe("ok");
  });
});

describe("cleanOrphanArchiveTmp", () => {
  it("does nothing when the archived directory doesn't exist yet (no throw)", async () => {
    await expect(
      cleanOrphanArchiveTmp(path.join(tmpDir, "does-not-exist")),
    ).resolves.toBeUndefined();
  });

  it("leaves non-matching entries and non-.tmp files alone", async () => {
    await mkdir(archivedDir, { recursive: true });
    await writeFile(path.join(archivedDir, "processed_real.zip"), "content");
    await writeFile(path.join(archivedDir, "unrelated.tmp"), "content"); // no PID segment
    await cleanOrphanArchiveTmp(archivedDir);
    expect((await readdir(archivedDir)).sort()).toEqual([
      "processed_real.zip",
      "unrelated.tmp",
    ]);
  });

  it("leaves a tmp file alone when its embedded PID is still alive (this process)", async () => {
    await mkdir(archivedDir, { recursive: true });
    const orphanName = `processed_x.zip.${process.pid.toString()}.tmp`;
    await writeFile(path.join(archivedDir, orphanName), "content");
    await cleanOrphanArchiveTmp(archivedDir);
    expect(await readdir(archivedDir)).toEqual([orphanName]);
  });

  it("removes a tmp file whose embedded PID no longer corresponds to a running process", async () => {
    await mkdir(archivedDir, { recursive: true });

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

    const orphanName = `processed_x.zip.${deadPid.toString()}.tmp`;
    await writeFile(path.join(archivedDir, orphanName), "content");
    await cleanOrphanArchiveTmp(archivedDir);
    expect(await readdir(archivedDir)).toEqual([]);
  });
});

describe("createZipArchive — low-level filesystem errors", () => {
  it("fails with mkdir:<code> when archivedDir's path is blocked by a file", async () => {
    const entries = [await writeSourceFile("a.wav", "content")];
    // A plain file sits where a *directory component* of zipPath needs to
    // be created — `mkdir(archivedDir, { recursive: true })` fails ENOTDIR.
    await writeFile(archivedDir, "not a directory");
    const zipPath = path.join(archivedDir, "sub", "processed_x.zip");

    const result = await createZipArchive({ sourceDir, entries, zipPath });
    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("type narrowing");
    expect(result.code).toMatch(/^mkdir:/);
  });

  it("fails (raw fs error code) when the .tmp path is occupied by a directory", async () => {
    const entries = [await writeSourceFile("a.wav", "content")];
    const zipPath = path.join(archivedDir, "processed_dirblock.zip");
    // The tmp name is deterministic (`<zipPath>.<pid>.tmp`) within a single
    // process — pre-create a directory there so `open(tmpPath, "w")` fails.
    await mkdir(archivedDir, { recursive: true });
    await mkdir(`${zipPath}.${process.pid.toString()}.tmp`);

    const result = await createZipArchive({ sourceDir, entries, zipPath });
    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("type narrowing");
    expect(result.code).not.toBe("");
  });

  it("cleans up the .tmp and reports the rename's error code when the destination is an occupied, non-empty directory", async () => {
    const entries = [await writeSourceFile("a.wav", "content")];
    const zipPath = path.join(archivedDir, "processed_renameblock.zip");
    // rename(2) onto an existing non-empty directory fails (EISDIR/ENOTEMPTY
    // depending on platform) — exercises the post-verify rename failure path.
    await mkdir(zipPath, { recursive: true });
    await writeFile(path.join(zipPath, "keep-me-non-empty"), "x");

    const result = await createZipArchive({ sourceDir, entries, zipPath });
    expect(result.kind).toBe("error");
    expect(await tmpFilesIn(archivedDir)).toEqual([]);
    // The directory that blocked the rename is untouched — createZipArchive
    // never unlinks/writes at the destination path itself, only its own tmp.
    await expect(
      stat(path.join(zipPath, "keep-me-non-empty")),
    ).resolves.toBeDefined();
  });

  it("reports a tagged error and cleans up when a source entry cannot be opened", async () => {
    // Covers open() failing (here: a directory where a file is expected).
    // NOTE: this does NOT cover read() failing *mid-stream* — that path (a
    // flaky SD card yanked during the run) has no automated test, because
    // making a successfully-opened regular file fail mid-read needs a seam we
    // deliberately did not add. It was verified by hand: before the fix in
    // `deflateEntry`, it froze the run forever with Ctrl+C disabled.
    const good = await writeSourceFile("a.wav", "content");
    await mkdir(path.join(sourceDir, "broken.wav"));
    const entries = [
      good,
      { name: "broken.wav", size: 7, mtime: new Date(2026, 0, 1) },
    ];
    const zipPath = path.join(archivedDir, "processed_unreadable.zip");

    const settled = await Promise.race([
      createZipArchive({ sourceDir, entries, zipPath }),
      new Promise<"HANG">((r) =>
        setTimeout(() => {
          r("HANG");
        }, 5000),
      ),
    ]);

    expect(settled).not.toBe("HANG");
    expect(await tmpFilesIn(archivedDir)).toEqual([]);
    await expect(stat(zipPath)).rejects.toThrow();
  });

  it("treats an abort landing in the finalization tail as an interruption, not an error", async () => {
    // verify → close → rename is not abortable mid-way; a Ctrl+C landing
    // there makes renameWithFallback return ABORT_ERR. Reporting that as an
    // error would show a bare ABORT_ERR code with no French explanation for
    // something the user just asked for.
    const entries = [await writeSourceFile("a.wav", "content")];
    const zipPath = path.join(archivedDir, "processed_taildabort.zip");
    const controller = new AbortController();

    const result = await createZipArchive({
      sourceDir,
      entries,
      zipPath,
      signal: controller.signal,
      // Fires after every entry is written, just before sync/verify/rename.
      corruptBeforeVerifyForTests: () => {
        controller.abort();
        return Promise.resolve();
      },
    });

    expect(result.kind).toBe("aborted");
    expect(await tmpFilesIn(archivedDir)).toEqual([]);
    await expect(stat(zipPath)).rejects.toThrow();
  });
});
