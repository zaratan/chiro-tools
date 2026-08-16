import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rewriteHeaderToStandardPcm } from "../wavHeader.js";
import { splitWavFile } from "../splitWavFile.js";
import { run as runPool } from "../splitWorkerPool.js";
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

  it("resolves with the file marked errored when a worker dies mid-file instead of hanging", async () => {
    const crashingWorkerPath = path.join(tmpDir, "crashing-worker.mjs");
    await writeFile(
      crashingWorkerPath,
      [
        'import { parentPort } from "node:worker_threads";',
        "if (parentPort !== null) {",
        '  parentPort.on("message", () => {',
        "    process.exit(1);",
        "  });",
        "}",
        "",
      ].join("\n"),
    );

    await writeWav("crash-me.wav", { durationSeconds: 2 });

    const outcome = await runPool(
      ["crash-me.wav"],
      tmpDir,
      { mode: "preserve" },
      { workerPath: crashingWorkerPath },
    );

    expect(outcome.processed).toEqual([]);
    expect(outcome.errored.length).toBe(1);
    expect(outcome.errored[0]?.file).toBe("crash-me.wav");
    expect(outcome.errored[0]?.reason).toBe("worker-died");
  }, 5000);

  it("fails the still-queued files too when every worker dies, instead of hanging", async () => {
    // The single-file tests above cannot reach `failRemainingQueue`: there is
    // nothing left in the queue when the one file dies. With more files than
    // workers, a death has to fail the *remaining* ones as well — otherwise
    // `pendingFiles` never reaches 0 and the batch never resolves. That is
    // the freeze class: no crash, no error screen, a progress bar that stops.
    const crashingWorkerPath = path.join(tmpDir, "crash-all-worker.mjs");
    await writeFile(
      crashingWorkerPath,
      [
        'import { parentPort } from "node:worker_threads";',
        "if (parentPort !== null) {",
        '  parentPort.on("message", () => {',
        '    throw new Error("boom");',
        "  });",
        "}",
        "",
      ].join("\n"),
    );

    // Two workers, six files: four are still queued when both die, which is
    // the only way to reach `failRemainingQueue`. With the default worker
    // count every file gets dispatched at once and the queue is empty.
    process.env.CHIRO_WORKER_COUNT = "2";
    const names = ["a.wav", "b.wav", "c.wav", "d.wav", "e.wav", "f.wav"];
    for (const n of names) await writeWav(n, { durationSeconds: 1 });

    const outcome = await runPool(
      names,
      tmpDir,
      { mode: "preserve" },
      { workerPath: crashingWorkerPath },
    );

    delete process.env.CHIRO_WORKER_COUNT;

    expect(outcome.processed).toEqual([]);
    expect(outcome.errored.map((e) => e.file).sort()).toEqual(
      [...names].sort(),
    );
    // The four that never reached a worker must carry the queue-level reason,
    // not the per-worker one — that is `failRemainingQueue` doing its job.
    expect(
      outcome.errored.filter((e) => e.reason === "no-workers-available").length,
    ).toBeGreaterThan(0);
  }, 15000);

  it("resolves with the file marked errored when a worker exits cleanly (code 0) mid-file instead of hanging forever", async () => {
    // A worker that calls process.exit(0) after receiving a file but before
    // ever posting file-done/file-error must still be treated as a death —
    // otherwise pendingFiles never reaches 0 and the batch hangs forever.
    const cleanExitWorkerPath = path.join(tmpDir, "clean-exit-worker.mjs");
    await writeFile(
      cleanExitWorkerPath,
      [
        'import { parentPort } from "node:worker_threads";',
        "if (parentPort !== null) {",
        '  parentPort.on("message", () => {',
        "    process.exit(0);",
        "  });",
        "}",
        "",
      ].join("\n"),
    );

    await writeWav("clean-exit.wav", { durationSeconds: 2 });

    const outcome = await runPool(
      ["clean-exit.wav"],
      tmpDir,
      { mode: "preserve" },
      { workerPath: cleanExitWorkerPath },
    );

    expect(outcome.processed).toEqual([]);
    expect(outcome.errored.length).toBe(1);
    expect(outcome.errored[0]?.file).toBe("clean-exit.wav");
    expect(outcome.errored[0]?.reason).toBe("worker-died");
  }, 5000);

  it("resolves quickly on abort even when some workers are idle (no full timeout wait)", async () => {
    const originalEnv = process.env.CHIRO_WORKER_COUNT;
    process.env.CHIRO_WORKER_COUNT = "2";

    try {
      await writeWav("fast.wav", {
        channels: 1,
        sampleRate: 8000,
        bitDepth: "16",
        durationSeconds: 1,
      });
      await writeWav("slow.wav", {
        channels: 1,
        sampleRate: 48000,
        bitDepth: "16",
        durationSeconds: 120,
      });

      const controller = new AbortController();
      const onProgress = (event: { kind: string }): void => {
        if (event.kind === "file-done") {
          controller.abort();
        }
      };

      // Wall-clock bounds are load-sensitive (this failed at 931 ms on a
      // busy CI runner with a 500 ms bound). Instead, raise the abort-ack
      // timeout to 10 s: the buggy path (waiting on idle workers) burns the
      // whole timeout, the fixed path returns as soon as busy workers ack —
      // the 8 s bound discriminates by seconds, not milliseconds.
      const startedAt = performance.now();
      const outcome = await runPool(
        ["fast.wav", "slow.wav"],
        tmpDir,
        { mode: "preserve" },
        { signal: controller.signal, onProgress, abortTimeoutMs: 10_000 },
      );
      const elapsed = performance.now() - startedAt;

      expect(outcome.interrupted).toBe(true);
      expect(elapsed).toBeLessThan(8000);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.CHIRO_WORKER_COUNT;
      } else {
        process.env.CHIRO_WORKER_COUNT = originalEnv;
      }
    }
  }, 15000);

  it("resolves quickly when abort races a worker's already-in-flight file-done (no full timeout wait)", async () => {
    // A single-chunk file makes the worker post "chunk-written" then
    // "file-done" back to back, with no I/O in between. Aborting from the
    // "chunk-written" progress callback races the main thread's abort
    // handling against the already-in-flight "file-done" message: by the
    // time abortAndWaitWorkers runs, ws.idle is still false (file-done not
    // processed yet), so the worker is classified as busy and awaited — but
    // it is actually idle already and will never post "aborted". Without
    // resolving abortedResolve from the file-done handler, this hangs for
    // the full ABORT_TIMEOUT_MS.
    const originalEnv = process.env.CHIRO_WORKER_COUNT;
    process.env.CHIRO_WORKER_COUNT = "1";

    try {
      await writeWav("race.wav", {
        channels: 1,
        sampleRate: 8000,
        bitDepth: "16",
        durationSeconds: 1,
      });

      const controller = new AbortController();
      const onProgress = (event: { kind: string }): void => {
        if (event.kind === "chunk-written") {
          controller.abort();
        }
      };

      // Same discrimination scheme as the idle-workers test above: a high
      // injected timeout instead of a load-sensitive wall-clock bound.
      const startedAt = performance.now();
      const outcome = await runPool(
        ["race.wav"],
        tmpDir,
        { mode: "preserve" },
        { signal: controller.signal, onProgress, abortTimeoutMs: 10_000 },
      );
      const elapsed = performance.now() - startedAt;

      expect(outcome.interrupted).toBe(true);
      expect(elapsed).toBeLessThan(8000);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.CHIRO_WORKER_COUNT;
      } else {
        process.env.CHIRO_WORKER_COUNT = originalEnv;
      }
    }
  }, 15000);

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
