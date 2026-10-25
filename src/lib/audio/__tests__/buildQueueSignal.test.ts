import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as BatchPlan from "../batchPlan.js";
import { buildQueue } from "../batchPlan.js";
import { estimateChunkCount } from "../estimateChunks.js";
import { runSoxBatch } from "../soxFastPath.js";
import { run as runPool } from "../splitWorkerPool.js";

vi.mock("../batchPlan.js", async (importOriginal) => {
  const actual = await importOriginal<typeof BatchPlan>();
  return { ...actual, buildQueue: vi.fn(actual.buildQueue) };
});

describe("callers of buildQueue", () => {
  let tmpDir: string;
  let controller: AbortController;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-queue-signal-"));
    controller = new AbortController();
    vi.mocked(buildQueue).mockClear();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  const expectSignalPassed = (): void => {
    expect(buildQueue).toHaveBeenCalledWith(
      [],
      tmpDir,
      expect.any(Number),
      controller.signal,
    );
  };

  it("the worker pool passes its signal, so a Ctrl+C stops the header reads", async () => {
    await runPool(
      [],
      tmpDir,
      { mode: "preserve" },
      { signal: controller.signal },
    );

    expectSignalPassed();
  });

  it("the sox batch passes its signal, so a Ctrl+C stops the header reads", async () => {
    await runSoxBatch(
      "sox",
      [],
      tmpDir,
      { mode: "preserve" },
      {
        signal: controller.signal,
      },
    );

    expectSignalPassed();
  });

  it("the estimate passes its signal, so leaving the screen stops the header reads", async () => {
    await estimateChunkCount([], tmpDir, "preserve", controller.signal);

    expectSignalPassed();
  });
});
