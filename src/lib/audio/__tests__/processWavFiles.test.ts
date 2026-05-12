import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgressEvent } from "../../../types.js";
import { processWavFiles } from "../processWavFiles.js";
import { makeRampWav, readSamplesPerChannel } from "./fixtures.js";

describe("processWavFiles", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-process-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const writeWav = async (
    name: string,
    opts: Parameters<typeof makeRampWav>[0] = {},
  ): Promise<void> => {
    await writeFile(path.join(tmpDir, name), makeRampWav(opts));
  };

  it("processes an empty file list to an empty outcome", async () => {
    const outcome = await processWavFiles([], tmpDir, { mode: "preserve" });
    expect(outcome.processed).toEqual([]);
    expect(outcome.errored).toEqual([]);
    expect(outcome.skippedTooLarge).toEqual([]);
    expect(outcome.skippedAlreadyChunked).toEqual([]);
    expect(outcome.interrupted).toBe(false);
  });

  it("splits one 11-second file into 3 chunks in processed/", async () => {
    await writeWav("source.wav", { durationSeconds: 11 });

    const outcome = await processWavFiles(["source.wav"], tmpDir, {
      mode: "preserve",
    });

    expect(outcome.errored).toEqual([]);
    expect(outcome.processed.length).toBe(1);
    const proc = outcome.processed[0];
    if (!proc) throw new Error("no processed entry");
    expect(proc.sourceFile).toBe("source.wav");
    expect(proc.chunkCount).toBe(3);
    expect(proc.outputSampleRate).toBe(48000);
    expect(proc.channels).toBe(1);

    const processedEntries = await readdir(path.join(tmpDir, "processed"));
    expect(processedEntries.sort()).toEqual([
      "source_000.wav",
      "source_001.wav",
      "source_002.wav",
    ]);
  });

  it("does not modify the source file (non-destructive)", async () => {
    const originalBuffer = makeRampWav({ durationSeconds: 6 });
    await writeFile(path.join(tmpDir, "source.wav"), originalBuffer);

    await processWavFiles(["source.wav"], tmpDir, { mode: "preserve" });

    // Source must still exist and be byte-identical.
    const { readFile } = await import("node:fs/promises");
    const afterRun = await readFile(path.join(tmpDir, "source.wav"));
    expect(Array.from(afterRun)).toEqual(Array.from(originalBuffer));
  });

  it("rewrites sampleRate in expand-10x mode without modifying the source", async () => {
    await writeWav("source.wav", { sampleRate: 250000, durationSeconds: 1 });

    const outcome = await processWavFiles(["source.wav"], tmpDir, {
      mode: "expand-10x",
    });

    expect(outcome.processed.length).toBe(1);
    const proc = outcome.processed[0];
    if (!proc) throw new Error("no processed entry");
    expect(proc.outputSampleRate).toBe(25000);

    // Source untouched: re-read its header.
    const { readFile } = await import("node:fs/promises");
    const sourceBuffer = await readFile(path.join(tmpDir, "source.wav"));
    expect(readSamplesPerChannel(sourceBuffer).sampleRate).toBe(250000);

    // Chunks have new rate.
    const chunkBuffer = await readFile(
      path.join(tmpDir, "processed", "source_000.wav"),
    );
    expect(readSamplesPerChannel(chunkBuffer).sampleRate).toBe(25000);
  });

  it("skips files matching _NNN.wav as already-chunked", async () => {
    await writeWav("foo_000.wav", { durationSeconds: 1 });
    await writeWav("regular.wav", { durationSeconds: 1 });

    const outcome = await processWavFiles(
      ["foo_000.wav", "regular.wav"],
      tmpDir,
      { mode: "preserve" },
    );

    expect(outcome.skippedAlreadyChunked).toEqual(["foo_000.wav"]);
    expect(outcome.processed.length).toBe(1);
    expect(outcome.processed[0]?.sourceFile).toBe("regular.wav");
  });

  it("records oversized files in skippedTooLarge", async () => {
    await writeWav("small.wav", { durationSeconds: 1 });
    await writeWav("big.wav", { durationSeconds: 1 });

    const outcome = await processWavFiles(
      ["small.wav", "big.wav"],
      tmpDir,
      { mode: "preserve" },
      { maxInputBytes: 100 },
    );

    expect(outcome.skippedTooLarge.length).toBe(2);
    expect(outcome.processed).toEqual([]);
  });

  it("records non-WAV files as errored without aborting the batch", async () => {
    await writeFile(path.join(tmpDir, "garbage.wav"), "not a wav");
    await writeWav("real.wav", { durationSeconds: 1 });

    const outcome = await processWavFiles(["garbage.wav", "real.wav"], tmpDir, {
      mode: "preserve",
    });

    expect(outcome.errored.length).toBe(1);
    expect(outcome.errored[0]?.file).toBe("garbage.wav");
    expect(outcome.processed.length).toBe(1);
    expect(outcome.processed[0]?.sourceFile).toBe("real.wav");
  });

  it("interrupts on aborted signal between files", async () => {
    await writeWav("a.wav", { durationSeconds: 1 });
    await writeWav("b.wav", { durationSeconds: 1 });

    const controller = new AbortController();
    controller.abort();

    const outcome = await processWavFiles(
      ["a.wav", "b.wav"],
      tmpDir,
      { mode: "preserve" },
      { signal: controller.signal },
    );

    expect(outcome.interrupted).toBe(true);
    expect(outcome.processed).toEqual([]);
  });

  it("leaves no orphan .tmp after a successful run", async () => {
    // After a normal run all `.tmp` files must have been renamed to their
    // final `.wav` names — no leftover from the atomic-write pattern.
    // Mid-batch abort behavior is covered by the integration test on real
    // AudioMoth data.
    await writeWav("source.wav", { durationSeconds: 30 });

    const outcome = await processWavFiles(["source.wav"], tmpDir, {
      mode: "preserve",
    });
    expect(outcome.processed.length).toBe(1);

    const entries = await readdir(path.join(tmpDir, "processed"));
    expect(entries.every((e) => !e.endsWith(".tmp"))).toBe(true);
  });

  it("pre-cleans orphan .tmp files from a previous interrupted run", async () => {
    await writeWav("source.wav", { durationSeconds: 1 });
    // Simulate a leftover orphan from a previous run.
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(tmpDir, "processed"), { recursive: true });
    await writeFile(
      path.join(tmpDir, "processed", "old_orphan.wav.tmp"),
      "leftover",
    );

    await processWavFiles(["source.wav"], tmpDir, { mode: "preserve" });

    const entries = await readdir(path.join(tmpDir, "processed"));
    expect(entries).not.toContain("old_orphan.wav.tmp");
  });

  it("emits progress events in the expected sequence for two nominal files", async () => {
    await writeWav("first.wav", { durationSeconds: 11 });
    await writeWav("second.wav", { durationSeconds: 6 });

    const events: ProgressEvent[] = [];
    const onProgress = vi.fn((e: ProgressEvent) => {
      events.push(e);
    });

    const outcome = await processWavFiles(
      ["first.wav", "second.wav"],
      tmpDir,
      { mode: "preserve" },
      { onProgress },
    );

    expect(outcome.errored).toEqual([]);
    expect(outcome.processed.length).toBe(2);

    // file-start for first file (fileIndex 0)
    const firstStart = events.find(
      (e) => e.kind === "file-start" && e.fileIndex === 0,
    );
    if (!firstStart) throw new Error("missing first file-start");
    if (firstStart.kind !== "file-start") throw new Error("wrong kind");
    expect(firstStart.fileName).toBe("first.wav");
    expect(firstStart.fileSizeBytes).toBeGreaterThan(0);
    expect(firstStart.totalFiles).toBe(2);

    // chunk-written events for first file
    const firstChunksWritten = events.filter(
      (e) => e.kind === "chunk-written" && e.fileIndex === 0,
    );
    // 11s / 5s = 3 chunks
    expect(firstChunksWritten.length).toBe(3);

    // file-done for first file
    const firstDone = events.find(
      (e) => e.kind === "file-done" && e.fileIndex === 0,
    );
    if (!firstDone) throw new Error("missing first file-done");
    if (firstDone.kind !== "file-done") throw new Error("wrong kind");
    expect(firstDone.chunkCount).toBe(3);
    expect(firstDone.fileSizeBytes).toBe(firstStart.fileSizeBytes);

    // file-start for second file (fileIndex 1)
    const secondStart = events.find(
      (e) => e.kind === "file-start" && e.fileIndex === 1,
    );
    if (!secondStart) throw new Error("missing second file-start");
    if (secondStart.kind !== "file-start") throw new Error("wrong kind");
    expect(secondStart.fileName).toBe("second.wav");
    expect(secondStart.totalFiles).toBe(2);

    // chunk-written events for second file
    const secondChunksWritten = events.filter(
      (e) => e.kind === "chunk-written" && e.fileIndex === 1,
    );
    // 6s / 5s = 2 chunks
    expect(secondChunksWritten.length).toBe(2);

    // file-done for second file
    const secondDone = events.find(
      (e) => e.kind === "file-done" && e.fileIndex === 1,
    );
    if (!secondDone) throw new Error("missing second file-done");
    if (secondDone.kind !== "file-done") throw new Error("wrong kind");
    expect(secondDone.chunkCount).toBe(2);
    expect(secondDone.fileSizeBytes).toBe(secondStart.fileSizeBytes);

    // Verify ordering: all events for file 0 come before file 1
    const firstStartIdx = events.indexOf(firstStart);
    const firstDoneIdx = events.indexOf(firstDone);
    const secondStartIdx = events.indexOf(secondStart);
    expect(firstStartIdx).toBeLessThan(firstDoneIdx);
    expect(firstDoneIdx).toBeLessThan(secondStartIdx);
  });

  it("emits file-start but no chunk-written or file-done for a garbage file", async () => {
    await writeFile(path.join(tmpDir, "garbage.wav"), "not a wav");
    await writeWav("good.wav", { durationSeconds: 6 });

    const events: ProgressEvent[] = [];
    const onProgress = vi.fn((e: ProgressEvent) => {
      events.push(e);
    });

    const outcome = await processWavFiles(
      ["garbage.wav", "good.wav"],
      tmpDir,
      { mode: "preserve" },
      { onProgress },
    );

    expect(outcome.errored.length).toBe(1);
    expect(outcome.errored[0]?.file).toBe("garbage.wav");

    // file-start IS emitted for the garbage file (before readFile + split attempt)
    const garbageStart = events.filter(
      (e) => e.kind === "file-start" && e.fileName === "garbage.wav",
    );
    expect(garbageStart.length).toBe(1);

    // No chunk-written or file-done for the garbage file
    const garbageChunks = events.filter(
      (e) =>
        (e.kind === "chunk-written" || e.kind === "file-done") &&
        e.fileIndex === 0,
    );
    expect(garbageChunks.length).toBe(0);

    // Good file still gets full sequence
    const goodChunks = events.filter(
      (e) => e.kind === "chunk-written" && e.fileIndex === 1,
    );
    expect(goodChunks.length).toBe(2);
    const goodDone = events.find(
      (e) => e.kind === "file-done" && e.fileIndex === 1,
    );
    expect(goodDone).toBeDefined();
  });

  it("emits no progress events for skippedTooLarge and skippedAlreadyChunked", async () => {
    await writeWav("small_000.wav", { durationSeconds: 1 });
    await writeWav("big.wav", { durationSeconds: 1 });

    const events: ProgressEvent[] = [];
    const onProgress = vi.fn((e: ProgressEvent) => {
      events.push(e);
    });

    await processWavFiles(
      ["small_000.wav", "big.wav"],
      tmpDir,
      { mode: "preserve" },
      { maxInputBytes: 100, onProgress },
    );

    // small_000.wav → skippedAlreadyChunked, big.wav → skippedTooLarge
    // Neither should emit any progress event
    expect(events).toHaveLength(0);
  });
});
