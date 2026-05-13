import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rewriteHeaderToStandardPcm } from "../wavHeader.js";
import { splitWavFile } from "../splitWavFile.js";
import { run as runPool, clampWorkerCount } from "../splitWorkerPool.js";
import { CHUNK_OUTPUT_SECONDS } from "../constants.js";
import { makeRampWav } from "./fixtures.js";

const sha256 = (data: Buffer | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

const padIndex = (n: number): string => String(n).padStart(3, "0");

describe("splitWorkerPool", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-pool-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const writeWav = async (
    name: string,
    opts: Parameters<typeof makeRampWav>[0] = {},
  ): Promise<string> => {
    const data = makeRampWav(opts);
    const filePath = path.join(tmpDir, name);
    await writeFile(filePath, data);
    return filePath;
  };

  const monoThreadSha256s = async (
    files: string[],
    mode: "preserve" | "expand-10x",
  ): Promise<Map<string, string>> => {
    const result = new Map<string, string>();

    for (const filePath of files) {
      const buffer = await readFile(filePath);
      const baseName = path.parse(filePath).name;
      const outSubDir = path.join(tmpDir, "mono-ref", baseName);
      const { mkdir } = await import("node:fs/promises");
      await mkdir(outSubDir, { recursive: true });

      for (const yielded of splitWavFile(buffer, {
        mode,
        chunkSeconds: CHUNK_OUTPUT_SECONDS,
      })) {
        if (yielded.kind !== "chunk") continue;
        const { chunk } = yielded;
        const chunkName = `${baseName}_${padIndex(chunk.index)}.wav`;
        const tmpPath = path.join(outSubDir, `${chunkName}.tmp`);
        await writeFile(tmpPath, chunk.buffer);
        // splitWavFile already encodes the correct output sample rate;
        // rewriteHeaderToStandardPcm just canonicalises the header without
        // re-dividing the rate (expand10x=false matches the worker behaviour).
        await rewriteHeaderToStandardPcm(tmpPath, false);
        const rewritten = await readFile(tmpPath);
        result.set(`${baseName}/${chunkName}`, sha256(rewritten));
      }
    }

    return result;
  };

  it("produces bit-exact output vs mono-thread pipeline for multiple files", async () => {
    const specs = [
      {
        name: "mono16-11s.wav",
        opts: {
          channels: 1,
          sampleRate: 48000,
          bitDepth: "16" as const,
          durationSeconds: 11,
        },
      },
      {
        name: "stereo24-6s.wav",
        opts: {
          channels: 2,
          sampleRate: 48000,
          bitDepth: "24" as const,
          durationSeconds: 6,
        },
      },
      {
        name: "expand-1s.wav",
        opts: {
          channels: 1,
          sampleRate: 250000,
          bitDepth: "16" as const,
          durationSeconds: 1,
        },
      },
      {
        name: "mono16-15s.wav",
        opts: {
          channels: 1,
          sampleRate: 48000,
          bitDepth: "16" as const,
          durationSeconds: 15,
        },
      },
      {
        name: "mono16-5s.wav",
        opts: {
          channels: 1,
          sampleRate: 38400,
          bitDepth: "16" as const,
          durationSeconds: 5,
        },
      },
    ];

    for (const { name, opts } of specs) {
      await writeWav(name, opts);
    }

    const mode = "preserve";
    const fileNames = specs.map((s) => s.name);
    const absolutePaths = fileNames.map((n) => path.join(tmpDir, n));

    const referenceHashes = await monoThreadSha256s(absolutePaths, mode);

    const outcome = await runPool(fileNames, tmpDir, { mode });
    expect(outcome.errored).toEqual([]);
    expect(outcome.processed.length).toBe(fileNames.length);

    const processedDir = path.join(tmpDir, "processed");
    const chunks = await readdir(processedDir);

    let checkedCount = 0;
    for (const chunkFile of chunks) {
      const baseName = chunkFile.replace(/_\d{3}\.wav$/, "");
      const key = `${baseName}/${chunkFile}`;
      const refHash = referenceHashes.get(key);
      if (refHash === undefined) continue;

      const actualData = await readFile(path.join(processedDir, chunkFile));
      const actualHash = sha256(actualData);
      expect(actualHash).toBe(refHash);
      checkedCount += 1;
    }

    expect(checkedCount).toBeGreaterThan(0);
  });

  it("bit-exact in expand-10x mode vs mono-thread pipeline", async () => {
    await writeWav("expand-10x.wav", {
      channels: 1,
      sampleRate: 250000,
      bitDepth: "16",
      durationSeconds: 1,
    });

    const mode = "expand-10x";
    const fileName = "expand-10x.wav";
    const absolutePath = path.join(tmpDir, fileName);

    const referenceHashes = await monoThreadSha256s([absolutePath], mode);

    const outcome = await runPool([fileName], tmpDir, { mode });
    expect(outcome.errored).toEqual([]);
    expect(outcome.processed.length).toBe(1);

    const processedDir = path.join(tmpDir, "processed");
    const chunks = await readdir(processedDir);

    for (const chunkFile of chunks) {
      const baseName = chunkFile.replace(/_\d{3}\.wav$/, "");
      const key = `${baseName}/${chunkFile}`;
      const refHash = referenceHashes.get(key);
      if (refHash === undefined) continue;

      const actualData = await readFile(path.join(processedDir, chunkFile));
      expect(sha256(actualData)).toBe(refHash);
    }
  });

  it("leaves no orphan .tmp files after abort", async () => {
    // Create enough files to keep workers busy when abort fires
    const fileCount = 10;
    for (let i = 0; i < fileCount; i++) {
      await writeWav(`file-${String(i).padStart(2, "0")}.wav`, {
        channels: 1,
        sampleRate: 48000,
        bitDepth: "16",
        durationSeconds: 12,
      });
    }

    const fileNames = Array.from(
      { length: fileCount },
      (_, i) => `file-${String(i).padStart(2, "0")}.wav`,
    );

    const controller = new AbortController();

    let doneCount = 0;
    const onProgress = (event: { kind: string }): void => {
      if (event.kind === "file-done") {
        doneCount += 1;
        if (doneCount >= 2) {
          controller.abort();
        }
      }
    };

    const outcome = await runPool(
      fileNames,
      tmpDir,
      { mode: "preserve" },
      {
        signal: controller.signal,
        onProgress,
      },
    );

    expect(outcome.interrupted).toBe(true);

    const processedDir = path.join(tmpDir, "processed");
    let entries: string[] = [];
    try {
      entries = await readdir(processedDir);
    } catch {
      // directory may not exist if abort was very fast
    }

    const orphans = entries.filter((e) => e.endsWith(".tmp"));
    expect(orphans).toEqual([]);
  }, 30000);

  it("continues batch after a file-error and records it in errored", async () => {
    const corruptPath = path.join(tmpDir, "corrupt.wav");
    await writeFile(corruptPath, Buffer.from("not a wav file at all"));
    await writeWav("good.wav", {
      channels: 1,
      sampleRate: 48000,
      bitDepth: "16",
      durationSeconds: 6,
    });

    const outcome = await runPool(["corrupt.wav", "good.wav"], tmpDir, {
      mode: "preserve",
    });

    expect(outcome.errored.length).toBe(1);
    expect(outcome.errored[0]?.file).toBe("corrupt.wav");
    expect(outcome.processed.length).toBe(1);

    const processedDir = path.join(tmpDir, "processed");
    const chunks = await readdir(processedDir);
    expect(chunks.some((c) => c.startsWith("good_"))).toBe(true);
  });

  it("skips already-chunked files (matching _NNN.wav)", async () => {
    await writeWav("source_000.wav", { durationSeconds: 1 });
    await writeWav("real.wav", { durationSeconds: 6 });

    const outcome = await runPool(["source_000.wav", "real.wav"], tmpDir, {
      mode: "preserve",
    });

    expect(outcome.skippedAlreadyChunked).toContain("source_000.wav");
    expect(outcome.processed.length).toBe(1);
  });

  it("skips files exceeding maxInputBytes", async () => {
    await writeWav("big.wav", { durationSeconds: 6 });

    const outcome = await runPool(
      ["big.wav"],
      tmpDir,
      { mode: "preserve" },
      { maxInputBytes: 100 },
    );

    expect(outcome.skippedTooLarge).toContain("big.wav");
    expect(outcome.processed).toEqual([]);
  });

  it("handles empty file list", async () => {
    const outcome = await runPool([], tmpDir, { mode: "preserve" });

    expect(outcome.processed).toEqual([]);
    expect(outcome.errored).toEqual([]);
    expect(outcome.interrupted).toBe(false);
  });

  it("respects CHIRO_WORKER_COUNT env override for concurrency", async () => {
    const originalEnv = process.env.CHIRO_WORKER_COUNT;
    process.env.CHIRO_WORKER_COUNT = "1";

    try {
      await writeWav("single-worker.wav", { durationSeconds: 6 });
      const outcome = await runPool(["single-worker.wav"], tmpDir, {
        mode: "preserve",
      });
      expect(outcome.processed.length).toBe(1);
      expect(outcome.errored).toEqual([]);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.CHIRO_WORKER_COUNT;
      } else {
        process.env.CHIRO_WORKER_COUNT = originalEnv;
      }
    }
  });

  describe("clampWorkerCount heuristic", () => {
    it("M1 16GB 8 cores → N=7 (CPU bound)", () => {
      // usable=11468 MB, maxByMemory=28, maxByCpu=7, HARD_CAP=12 → 7
      expect(clampWorkerCount(8, 16 * 1024)).toBe(7);
    });

    it("M1 Max 64GB 10 cores → N=9 (CPU bound)", () => {
      // usable=45875 MB, maxByMemory=114, maxByCpu=9, HARD_CAP=12 → 9
      expect(clampWorkerCount(10, 64 * 1024)).toBe(9);
    });

    it("Linux 32GB 16 cores → N=12 (HARD_CAP bound)", () => {
      // usable=22937 MB, maxByMemory=57, maxByCpu=15, HARD_CAP=12 → 12
      expect(clampWorkerCount(16, 32 * 1024)).toBe(12);
    });

    it("tiny machine: 2 cores, 4GB → N=2 (MIN_WORKERS floor)", () => {
      // usable=2867 MB, maxByMemory=7, maxByCpu=1, MAX(2,MIN(7,1,12))=2
      expect(clampWorkerCount(2, 4 * 1024)).toBe(2);
    });

    it("single-core: 1 core, 8GB → N=2 (MIN_WORKERS floor, maxByCpu=0)", () => {
      // maxByCpu=0, MIN(14,0,12)=0, MAX(2,0)=2
      expect(clampWorkerCount(1, 8 * 1024)).toBe(2);
    });
  });

  it("returns interrupted=true if signal is already aborted before run", async () => {
    await writeWav("source.wav", { durationSeconds: 6 });

    const controller = new AbortController();
    controller.abort();

    const outcome = await runPool(
      ["source.wav"],
      tmpDir,
      { mode: "preserve" },
      {
        signal: controller.signal,
      },
    );

    expect(outcome.interrupted).toBe(true);
    expect(outcome.processed).toEqual([]);
  });

  it("writes files atomically (no partial .wav without corresponding .tmp rename)", async () => {
    // 120 s @ 48 kHz mono with 50 s chunks → 3 output chunks (2 full + 1 tail).
    await writeWav("atomic-test.wav", {
      channels: 1,
      sampleRate: 48000,
      bitDepth: "16",
      durationSeconds: 120,
    });

    const outcome = await runPool(["atomic-test.wav"], tmpDir, {
      mode: "preserve",
    });
    expect(outcome.processed.length).toBe(1);

    const processedDir = path.join(tmpDir, "processed");
    const entries = await readdir(processedDir);

    // All output files are final .wav, no stray .tmp
    expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
    expect(entries.filter((e) => e.endsWith(".wav")).length).toBe(3);

    // Each file is a valid WAV (RIFF header)
    for (const entry of entries) {
      const buf = await readFile(path.join(processedDir, entry));
      expect(buf.subarray(0, 4).toString("ascii")).toBe("RIFF");
    }
  });

  it("chunk output files have canonical 44-byte header (audioFormat=1)", async () => {
    // 120 s @ 48 kHz mono with 50 s chunks → 3 output chunks.
    await writeWav("canonical-test.wav", {
      channels: 1,
      sampleRate: 48000,
      bitDepth: "16",
      durationSeconds: 120,
    });

    const outcome = await runPool(["canonical-test.wav"], tmpDir, {
      mode: "preserve",
    });
    expect(outcome.processed.length).toBe(1);

    const processedDir = path.join(tmpDir, "processed");
    const chunks = await readdir(processedDir);
    expect(chunks.length).toBe(3);

    for (const chunkFile of chunks) {
      const buf = await readFile(path.join(processedDir, chunkFile));
      expect(buf.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(buf.readUInt32LE(16)).toBe(16);
      expect(buf.readUInt16LE(20)).toBe(1);
      expect(buf.subarray(36, 40).toString("ascii")).toBe("data");
    }
  });

  it("non-existent source file is recorded as errored without crashing batch", async () => {
    await writeWav("real.wav", { durationSeconds: 6 });

    // Stat is called in the pool, missing file → errored
    const outcome = await runPool(["missing.wav", "real.wav"], tmpDir, {
      mode: "preserve",
    });

    expect(outcome.errored.length).toBe(1);
    expect(outcome.errored[0]?.file).toBe("missing.wav");
    expect(outcome.processed.length).toBe(1);
  });

  it("stress abort: queue of 15 files, abort after 3 done → no orphan tmps", async () => {
    const fileCount = 15;
    const fileNames: string[] = [];

    for (let i = 0; i < fileCount; i++) {
      const name = `stress-${String(i).padStart(2, "0")}.wav`;
      await writeWav(name, {
        channels: 1,
        sampleRate: 48000,
        bitDepth: "16",
        durationSeconds: 8,
      });
      fileNames.push(name);
    }

    const controller = new AbortController();
    let doneCount = 0;

    const outcome = await runPool(
      fileNames,
      tmpDir,
      { mode: "preserve" },
      {
        signal: controller.signal,
        onProgress: (event) => {
          if (event.kind === "file-done") {
            doneCount += 1;
            if (doneCount >= 3) {
              controller.abort();
            }
          }
        },
      },
    );

    expect(outcome.interrupted).toBe(true);
    expect(outcome.processed.length).toBeGreaterThanOrEqual(3);
    expect(outcome.processed.length).toBeLessThan(fileCount);

    let entries: string[] = [];
    try {
      entries = await readdir(path.join(tmpDir, "processed"));
    } catch {
      // ok if dir doesn't exist
    }
    const orphans = entries.filter((e) => e.endsWith(".tmp"));
    expect(orphans).toEqual([]);
  }, 60000);
});
