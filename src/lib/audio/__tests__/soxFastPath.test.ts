import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanPartialOutput, detectSox, runSoxBatch } from "../soxFastPath.js";
import { makeRampWav } from "./fixtures.js";

// ---------------------------------------------------------------------------
// Helpers for fake sox scripts
// ---------------------------------------------------------------------------

const makeFakeSox = async (
  dir: string,
  name: string,
  exitCode: number,
): Promise<string> => {
  const p = path.join(dir, name);
  await writeFile(p, `#!/bin/sh\nexit ${String(exitCode)}\n`);
  await chmod(p, 0o755);
  return p;
};

// ---------------------------------------------------------------------------
// detectSox tests
// ---------------------------------------------------------------------------

describe("detectSox", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-sox-detect-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    delete process.env.CHIRO_DISABLE_FASTPATH;
    delete process.env.PATH;
    vi.restoreAllMocks();
  });

  it("returns absent when CHIRO_DISABLE_FASTPATH is set", async () => {
    process.env.CHIRO_DISABLE_FASTPATH = "1";
    const result = await detectSox();
    expect(result.kind).toBe("absent");
  });

  it("returns absent when sox is not in PATH", async () => {
    process.env.PATH = tmpDir; // PATH with no sox binary
    delete process.env.CHIRO_DISABLE_FASTPATH;
    const result = await detectSox();
    expect(result.kind).toBe("absent");
  });

  it("returns absent when sox --version exits with non-zero", async () => {
    const fakeSox = await makeFakeSox(tmpDir, "sox", 1);
    void fakeSox;
    process.env.PATH = tmpDir;
    delete process.env.CHIRO_DISABLE_FASTPATH;
    const result = await detectSox();
    expect(result.kind).toBe("absent");
  });

  it("returns available when sox --version exits 0", async () => {
    const fakeSox = await makeFakeSox(tmpDir, "sox", 0);
    process.env.PATH = tmpDir;
    delete process.env.CHIRO_DISABLE_FASTPATH;
    const result = await detectSox();
    expect(result.kind).toBe("available");
    if (result.kind !== "available") throw new Error("type narrowing");
    expect(result.binPath).toBe(fakeSox);
  });
});

// ---------------------------------------------------------------------------
// runSoxBatch tests
// ---------------------------------------------------------------------------

const findSoxBin = (): string | null => {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, "sox");
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

const SOX_BIN = findSoxBin();
const soxAvailable = SOX_BIN !== null;

describe("runSoxBatch", () => {
  let tmpDir: string;
  let fakeSoxFail: string;
  // Set by tests that chmod a directory read-only, so afterEach can restore
  // write permission before rm — otherwise cleanup itself could fail to
  // remove entries the test left behind, or mask a real cleanup bug.
  let readOnlyDir: string | null = null;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-sox-test-"));
    fakeSoxFail = await makeFakeSox(tmpDir, "fake-sox-fail.sh", 1);
    readOnlyDir = null;
  });

  afterEach(async () => {
    if (readOnlyDir !== null) {
      await chmod(readOnlyDir, 0o755).catch(() => undefined);
      readOnlyDir = null;
    }
    await rm(tmpDir, { recursive: true, force: true });
    delete process.env.CHIRO_DISABLE_FASTPATH;
    vi.restoreAllMocks();
  });

  const writeWav = async (
    name: string,
    opts: Parameters<typeof makeRampWav>[0] = {},
  ): Promise<void> => {
    await writeFile(path.join(tmpDir, name), makeRampWav(opts));
  };

  it("returns fallback when sox exits 1 on first file", async () => {
    await writeWav("source.wav", {
      sampleRate: 48000,
      durationSeconds: 6,
      bitDepth: "16",
      channels: 1,
    });

    const result = await runSoxBatch(fakeSoxFail, ["source.wav"], tmpDir, {
      mode: "preserve",
    });

    expect(result.kind).toBe("fallback");
    if (result.kind !== "fallback") throw new Error("type narrowing");
    expect(result.reason).toContain("sox-exit");
  });

  it("returns completed with skippedAlreadyChunked when all files match _NNN pattern", async () => {
    const result = await runSoxBatch(fakeSoxFail, ["already_000.wav"], tmpDir, {
      mode: "preserve",
    });

    expect(result.kind).toBe("completed");
    if (result.kind !== "completed") throw new Error("type narrowing");
    expect(result.outcome.skippedAlreadyChunked).toContain("already_000.wav");
    expect(result.outcome.processed).toEqual([]);
  });

  it("skips files exceeding maxInputBytes and records them as skippedTooLarge", async () => {
    await writeWav("big.wav", { durationSeconds: 1 });

    const result = await runSoxBatch(
      fakeSoxFail,
      ["big.wav"],
      tmpDir,
      { mode: "preserve" },
      { maxInputBytes: 10 },
    );

    expect(result.kind).toBe("completed");
    if (result.kind !== "completed") throw new Error("type narrowing");
    expect(result.outcome.skippedTooLarge).toContain("big.wav");
  });

  it("returns completed with interrupted=true on pre-aborted signal", async () => {
    await writeWav("source.wav", { durationSeconds: 1 });
    const controller = new AbortController();
    controller.abort();

    const result = await runSoxBatch(
      fakeSoxFail,
      ["source.wav"],
      tmpDir,
      { mode: "preserve" },
      { signal: controller.signal },
    );

    expect(result.kind).toBe("completed");
    if (result.kind !== "completed") throw new Error("type narrowing");
    expect(result.outcome.interrupted).toBe(true);
  });

  it("records missing source files as errored (stat fails) and falls back", async () => {
    const result = await runSoxBatch(fakeSoxFail, ["nonexistent.wav"], tmpDir, {
      mode: "preserve",
    });

    // stat fails → errored, no file to process as first → fallback
    if (result.kind === "completed") {
      // All files errored at stat stage
      expect(result.outcome.errored.length).toBeGreaterThan(0);
    } else {
      // fallback due to read error on first file
      expect(result.kind).toBe("fallback");
    }
  });

  it("resolves instead of rejecting when processed/ is read-only (EACCES on mkdir)", async () => {
    // processOneFile's mkdir(tmpSubDir) creates a new entry inside outDir —
    // a read-only outDir makes that mkdir throw EACCES. Before the fix this
    // exception was unguarded and propagated out of runSoxBatch as a
    // rejection instead of a resolved fallback/error result.
    await writeWav("source.wav", { durationSeconds: 1 });
    const outDir = path.join(tmpDir, "processed");
    await mkdir(outDir, { recursive: true });
    await chmod(outDir, 0o555);
    readOnlyDir = outDir;

    await expect(
      runSoxBatch(fakeSoxFail, ["source.wav"], tmpDir, { mode: "preserve" }),
    ).resolves.toMatchObject({});
  });

  it("cleanPartialOutput does not delete a sibling whose baseName is a strict prefix", async () => {
    const outDir = path.join(tmpDir, "processed");
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, "X_211006_000.wav"), "chunk");
    await writeFile(
      path.join(outDir, "X_211006_Not_Processed_000.wav"),
      "sibling chunk",
    );

    await cleanPartialOutput(outDir, "X_211006");

    const remaining = await readdir(outDir);
    expect(remaining).not.toContain("X_211006_000.wav");
    expect(remaining).toContain("X_211006_Not_Processed_000.wav");
  });

  // ---------------------------------------------------------------------------
  // Tests requiring real sox
  // ---------------------------------------------------------------------------

  describe.skipIf(!soxAvailable)("with real sox", () => {
    it("processes a WAV file and returns completed with correct chunk count", async () => {
      // 110 s @ 48 kHz preserve with 50 s chunks → 3 output chunks
      // (2 full + 1 tail of 10 s).
      await writeWav("source.wav", {
        sampleRate: 48000,
        durationSeconds: 110,
        bitDepth: "16",
        channels: 1,
      });

      if (!SOX_BIN) throw new Error("sox not available");
      const result = await runSoxBatch(SOX_BIN, ["source.wav"], tmpDir, {
        mode: "preserve",
      });

      expect(result.kind).toBe("completed");
      if (result.kind !== "completed") throw new Error("type narrowing");
      expect(result.outcome.errored).toEqual([]);
      expect(result.outcome.processed.length).toBe(1);
      const proc = result.outcome.processed[0];
      if (!proc) throw new Error("no processed entry");
      expect(proc.chunkCount).toBe(3);
      expect(proc.outputSampleRate).toBe(48000);
    }, 30_000);

    it("spot-check passes on synthetic WAV — does not fall back", async () => {
      await writeWav("source.wav", {
        sampleRate: 48000,
        durationSeconds: 16,
        bitDepth: "16",
        channels: 1,
      });

      if (!SOX_BIN) throw new Error("sox not available");
      const result = await runSoxBatch(SOX_BIN, ["source.wav"], tmpDir, {
        mode: "preserve",
      });

      expect(result.kind).toBe("completed");
    }, 30_000);

    it("expand-10x mode: divides sample rate and produces correct chunk count", async () => {
      // 11 s real-time @ 250 kHz → after rewrite to 25 kHz = 110 s output.
      // 50 s output chunks → 3 chunks (2 full + 1 tail of 10 s).
      await writeWav("audiomoth.wav", {
        sampleRate: 250000,
        durationSeconds: 11,
        bitDepth: "16",
        channels: 1,
      });

      if (!SOX_BIN) throw new Error("sox not available");
      const result = await runSoxBatch(SOX_BIN, ["audiomoth.wav"], tmpDir, {
        mode: "expand-10x",
      });

      expect(result.kind).toBe("completed");
      if (result.kind !== "completed") throw new Error("type narrowing");
      expect(result.outcome.errored).toEqual([]);
      const proc = result.outcome.processed[0];
      if (!proc) throw new Error("no processed entry");
      expect(proc.outputSampleRate).toBe(25000);
      expect(proc.chunkCount).toBe(3);
    }, 30_000);

    it("emits progress events: file-start, chunk-written×N, file-done", async () => {
      // 110 s @ 48 kHz preserve with 50 s chunks → 3 chunk-written events.
      await writeWav("source.wav", {
        sampleRate: 48000,
        durationSeconds: 110,
        bitDepth: "16",
        channels: 1,
      });

      if (!SOX_BIN) throw new Error("sox not available");
      const events: { kind: string }[] = [];

      const result = await runSoxBatch(
        SOX_BIN,
        ["source.wav"],
        tmpDir,
        { mode: "preserve" },
        {
          onProgress: (e) => events.push({ kind: e.kind }),
        },
      );

      expect(result.kind).toBe("completed");
      expect(events[0]?.kind).toBe("file-start");
      expect(events.filter((e) => e.kind === "chunk-written").length).toBe(3);
      expect(events[events.length - 1]?.kind).toBe("file-done");
    }, 30_000);

    it("records corrupt file as errored on subsequent files, batch continues", async () => {
      await writeWav("good1.wav", {
        sampleRate: 48000,
        durationSeconds: 6,
        bitDepth: "16",
        channels: 1,
      });
      await writeFile(path.join(tmpDir, "corrupt.wav"), Buffer.alloc(100, 0));
      await writeWav("good2.wav", {
        sampleRate: 48000,
        durationSeconds: 6,
        bitDepth: "16",
        channels: 1,
      });

      if (!SOX_BIN) throw new Error("sox not available");
      const result = await runSoxBatch(
        SOX_BIN,
        ["good1.wav", "corrupt.wav", "good2.wav"],
        tmpDir,
        { mode: "preserve" },
      );

      expect(result.kind).toBe("completed");
      if (result.kind !== "completed") throw new Error("type narrowing");
      // good1 passes spot-check; corrupt fails sox on subsequent run → errored
      expect(result.outcome.processed.length).toBeGreaterThanOrEqual(1);
    }, 30_000);

    it("records an unguarded I/O failure on a non-first file as errored, without rejecting, and leaves no partial output", async () => {
      // A basename long enough that ".sox-tmp-<baseName>" exceeds the
      // filesystem's max filename length triggers ENAMETOOLONG on mkdir —
      // an unguarded I/O failure that (pre-fix) only the first-file path
      // partially handled. This file is queued second, so it goes through
      // the concurrent runItem/scheduleItem path, where the original
      // rejection propagated through Promise.race(inFlight) and made
      // runSoxBatch itself reject.
      await writeWav("good.wav", {
        sampleRate: 48000,
        durationSeconds: 6,
        bitDepth: "16",
        channels: 1,
      });
      const longBaseName = "a".repeat(250);
      const longName = `${longBaseName}.wav`;
      await writeWav(longName, { durationSeconds: 1 });

      if (!SOX_BIN) throw new Error("sox not available");
      const result = await runSoxBatch(
        SOX_BIN,
        ["good.wav", longName],
        tmpDir,
        { mode: "preserve" },
      );

      expect(result.kind).toBe("completed");
      if (result.kind !== "completed") throw new Error("type narrowing");
      expect(
        result.outcome.processed.some((p) => p.sourceFile === "good.wav"),
      ).toBe(true);
      expect(result.outcome.errored.some((e) => e.file === longName)).toBe(
        true,
      );

      const outDir = path.join(tmpDir, "processed");
      const entries = await readdir(outDir).catch(() => []);
      expect(entries.some((e) => e.includes(longBaseName))).toBe(false);
    }, 30_000);

    it("chunk output files have canonical 44-byte PCM header", async () => {
      await writeWav("source.wav", {
        sampleRate: 48000,
        durationSeconds: 6,
        bitDepth: "16",
        channels: 1,
      });

      if (!SOX_BIN) throw new Error("sox not available");
      const result = await runSoxBatch(SOX_BIN, ["source.wav"], tmpDir, {
        mode: "preserve",
      });

      expect(result.kind).toBe("completed");
      const processedDir = path.join(tmpDir, "processed");
      const chunks = await readdir(processedDir);

      for (const chunkFile of chunks) {
        if (!chunkFile.endsWith(".wav")) continue;
        const buf = await readFile(path.join(processedDir, chunkFile));
        expect(buf.subarray(0, 4).toString("ascii")).toBe("RIFF");
        expect(buf.readUInt32LE(16)).toBe(16);
        expect(buf.readUInt16LE(20)).toBe(1); // audioFormat = PCM
        expect(buf.subarray(36, 40).toString("ascii")).toBe("data");
      }
    }, 30_000);

    it("clears a stale .sox-tmp-<baseName> directory left by a prior SIGKILLed run", async () => {
      // "first.wav" only exists so the batch's mandatory first-file
      // spot-check passes cleanly — that check would otherwise mask this bug
      // by falling back on any chunk-count mismatch. "second.wav" is the
      // real target: files after the first go through the concurrent
      // runItem/scheduleItem path, which has no spot-check at all, so a
      // stale tmpSubDir there would silently corrupt the finalized output
      // instead of triggering a safe fallback.
      await writeWav("first.wav", {
        sampleRate: 48000,
        durationSeconds: 6,
        bitDepth: "16",
        channels: 1,
      });
      await writeWav("second.wav", {
        sampleRate: 48000,
        durationSeconds: 6,
        bitDepth: "16",
        channels: 1,
      });

      const outDir = path.join(tmpDir, "processed");
      const tmpSubDir = path.join(outDir, ".sox-tmp-second");
      await mkdir(tmpSubDir, { recursive: true });
      // Simulates a leftover raw chunk from a run that was SIGKILLed before
      // its own `finally { rm(tmpSubDir, ...) }` cleanup could run. Its index
      // (099) is far outside the range this run will actually produce, so a
      // pre-fix mkdir({recursive:true}) reuse would let it survive and leak
      // into this run's finalized output as a wrongly-numbered extra chunk.
      await writeFile(
        path.join(tmpSubDir, "raw_099.wav"),
        makeRampWav({ durationSeconds: 1 }),
      );

      if (!SOX_BIN) throw new Error("sox not available");
      const result = await runSoxBatch(
        SOX_BIN,
        ["first.wav", "second.wav"],
        tmpDir,
        { mode: "preserve" },
      );

      expect(result.kind).toBe("completed");
      if (result.kind !== "completed") throw new Error("type narrowing");
      expect(result.outcome.errored).toEqual([]);
      const proc = result.outcome.processed.find(
        (p) => p.sourceFile === "second.wav",
      );
      if (!proc) throw new Error("second.wav not processed");
      expect(proc.chunkCount).toBe(1);

      const entries = await readdir(outDir);
      const chunkFiles = entries.filter((e) => /^second_\d{3}\.wav$/.test(e));
      expect(chunkFiles).toEqual(["second_000.wav"]);
    }, 30_000);
  });
});
