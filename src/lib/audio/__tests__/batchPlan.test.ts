import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ALREADY_CHUNKED_REGEX,
  buildChunkName,
  buildOutDir,
  buildQueue,
  clampWorkerCount,
  computeConcurrency,
  DEFAULT_MAX_INPUT_BYTES,
  makeEmit,
  PROCESSED_DIR_DISPLAY,
  PROCESSED_DIRNAME,
} from "../batchPlan.js";
import type { ProgressEvent } from "../../../types.js";

// ---------------------------------------------------------------------------
// buildOutDir / constants
// ---------------------------------------------------------------------------

describe("buildOutDir", () => {
  it("joins the given directory with the processed subdirectory name", () => {
    expect(buildOutDir("/some/dir")).toBe(path.join("/some/dir", "processed"));
    expect(PROCESSED_DIRNAME).toBe("processed");
  });
});

describe("buildChunkName", () => {
  it("pads the index to 3 digits and appends .wav", () => {
    expect(buildChunkName("x", 1)).toBe("x_001.wav");
    expect(buildChunkName("source", 0)).toBe("source_000.wav");
  });

  it("produces names recognized by ALREADY_CHUNKED_REGEX", () => {
    expect(ALREADY_CHUNKED_REGEX.test(buildChunkName("x", 1))).toBe(true);
  });
});

describe("PROCESSED_DIR_DISPLAY", () => {
  it("is the relative-path form shown to the user", () => {
    expect(PROCESSED_DIR_DISPLAY).toBe("./processed/");
  });
});

describe("DEFAULT_MAX_INPUT_BYTES", () => {
  it("is 500 MiB", () => {
    expect(DEFAULT_MAX_INPUT_BYTES).toBe(500 * 1024 * 1024);
  });
});

// ---------------------------------------------------------------------------
// buildQueue — shared admission policy for both pipelines
// ---------------------------------------------------------------------------

describe("buildQueue", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-batchplan-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const writeFixture = async (
    name: string,
    sizeBytes: number,
  ): Promise<void> => {
    await writeFile(path.join(tmpDir, name), Buffer.alloc(sizeBytes));
  };

  it("admits regular files under the size limit", async () => {
    await writeFixture("source.wav", 100);

    const result = await buildQueue(
      ["source.wav"],
      tmpDir,
      DEFAULT_MAX_INPUT_BYTES,
    );

    expect(result.queue).toHaveLength(1);
    expect(result.queue[0]).toEqual({
      file: "source.wav",
      fileIndex: 0,
      fileSizeBytes: 100,
      absSource: path.join(tmpDir, "source.wav"),
      baseName: "source",
    });
    expect(result.skippedTooLarge).toEqual([]);
    expect(result.skippedAlreadyChunked).toEqual([]);
    expect(result.errored).toEqual([]);
  });

  it("skips files matching the already-chunked pattern (_NNN.wav) without statting them", async () => {
    // Deliberately not written to disk — a stat call on it would error out
    // as ENOENT, proving the already-chunked check short-circuits first.
    const result = await buildQueue(
      ["source_000.wav"],
      tmpDir,
      DEFAULT_MAX_INPUT_BYTES,
    );

    expect(result.skippedAlreadyChunked).toEqual(["source_000.wav"]);
    expect(result.queue).toEqual([]);
    expect(result.errored).toEqual([]);
  });

  it("matches the already-chunked pattern case-insensitively", async () => {
    const result = await buildQueue(
      ["source_001.WAV"],
      tmpDir,
      DEFAULT_MAX_INPUT_BYTES,
    );

    expect(result.skippedAlreadyChunked).toEqual(["source_001.WAV"]);
  });

  it("skips files exceeding maxInputBytes", async () => {
    await writeFixture("big.wav", 1000);

    const result = await buildQueue(["big.wav"], tmpDir, 500);

    expect(result.skippedTooLarge).toEqual(["big.wav"]);
    expect(result.queue).toEqual([]);
  });

  it("admits a file whose size exactly equals maxInputBytes", async () => {
    await writeFixture("exact.wav", 500);

    const result = await buildQueue(["exact.wav"], tmpDir, 500);

    expect(result.queue).toHaveLength(1);
    expect(result.skippedTooLarge).toEqual([]);
  });

  it("records a stat failure as an errored entry and continues with the rest", async () => {
    await writeFixture("good.wav", 10);

    const result = await buildQueue(
      ["missing.wav", "good.wav"],
      tmpDir,
      DEFAULT_MAX_INPUT_BYTES,
    );

    expect(result.errored).toEqual([{ file: "missing.wav", reason: "ENOENT" }]);
    expect(result.queue).toHaveLength(1);
    expect(result.queue[0]?.file).toBe("good.wav");
  });

  it("assigns fileIndex by original position, including skipped/errored entries", async () => {
    await writeFixture("a.wav", 10);
    await writeFixture("c.wav", 10);

    const result = await buildQueue(
      ["a.wav", "b_000.wav", "c.wav"],
      tmpDir,
      DEFAULT_MAX_INPUT_BYTES,
    );

    expect(result.queue.map((q) => [q.file, q.fileIndex])).toEqual([
      ["a.wav", 0],
      ["c.wav", 2],
    ]);
  });

  it("returns empty results for an empty file list", async () => {
    const result = await buildQueue([], tmpDir, DEFAULT_MAX_INPUT_BYTES);

    expect(result).toEqual({
      queue: [],
      skippedTooLarge: [],
      skippedAlreadyChunked: [],
      errored: [],
    });
  });
});

// ---------------------------------------------------------------------------
// computeConcurrency
// ---------------------------------------------------------------------------

describe("computeConcurrency", () => {
  afterEach(() => {
    delete process.env.CHIRO_WORKER_COUNT;
  });

  it("uses CHIRO_WORKER_COUNT when set to a valid positive integer", () => {
    process.env.CHIRO_WORKER_COUNT = "3";
    expect(computeConcurrency()).toBe(3);
  });

  it("falls back to the clamp heuristic when CHIRO_WORKER_COUNT is unset", () => {
    delete process.env.CHIRO_WORKER_COUNT;
    expect(computeConcurrency()).toBeGreaterThanOrEqual(2);
  });

  it("falls back to the clamp heuristic when CHIRO_WORKER_COUNT is not a positive integer", () => {
    process.env.CHIRO_WORKER_COUNT = "not-a-number";
    expect(computeConcurrency()).toBeGreaterThanOrEqual(2);

    process.env.CHIRO_WORKER_COUNT = "0";
    expect(computeConcurrency()).toBeGreaterThanOrEqual(2);

    process.env.CHIRO_WORKER_COUNT = "-1";
    expect(computeConcurrency()).toBeGreaterThanOrEqual(2);
  });
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

// ---------------------------------------------------------------------------
// makeEmit
// ---------------------------------------------------------------------------

describe("makeEmit", () => {
  const sampleEvent: ProgressEvent = {
    kind: "file-start",
    fileIndex: 0,
    fileName: "a.wav",
    fileSizeBytes: 1,
    totalFiles: 1,
  };

  it("returns a no-op when no callback is given", () => {
    const emit = makeEmit(undefined);
    expect(() => {
      emit(sampleEvent);
    }).not.toThrow();
  });

  it("forwards events to the given callback", () => {
    const received: ProgressEvent[] = [];
    const emit = makeEmit((event) => received.push(event));

    emit(sampleEvent);

    expect(received).toEqual([sampleEvent]);
  });

  it("swallows exceptions thrown by the callback", () => {
    const emit = makeEmit(() => {
      throw new Error("boom");
    });

    expect(() => {
      emit(sampleEvent);
    }).not.toThrow();
  });
});
