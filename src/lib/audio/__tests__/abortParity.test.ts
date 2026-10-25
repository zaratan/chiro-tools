import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { processWavFiles, type ProcessResult } from "../processWavFiles.js";
import type { ProgressEvent } from "../../../types.js";
import { makeRampWav } from "./fixtures.js";

const findSoxBin = (): string | null => {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (dir === "") continue;
    const candidate = path.join(dir, "sox");
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

const SOX_BIN = findSoxBin();
const RECORDINGS = ["A.wav", "B.wav"];
const TWENTY_CHUNKS = makeRampWav({ sampleRate: 8000, durationSeconds: 1000 });

const listOutputs = async (dir: string): Promise<string[]> =>
  (await readdir(path.join(dir, "processed"))).sort();

const announcedChunks = (result: ProcessResult): string[] =>
  result.processed
    .flatMap((p) =>
      Array.from(
        { length: p.chunkCount },
        (_, i) =>
          `${path.parse(p.sourceFile).name}_${String(i).padStart(3, "0")}.wav`,
      ),
    )
    .sort();

describe.skipIf(SOX_BIN === null)(
  "abort parity between sox and the worker pool",
  () => {
    let soxDir: string;
    let poolDir: string;
    let savedWorkerCount: string | undefined;

    beforeEach(async () => {
      soxDir = await mkdtemp(path.join(tmpdir(), "chiro-abort-sox-"));
      poolDir = await mkdtemp(path.join(tmpdir(), "chiro-abort-pool-"));
      savedWorkerCount = process.env.CHIRO_WORKER_COUNT;
      process.env.CHIRO_WORKER_COUNT = "1";
      for (const name of RECORDINGS) {
        await writeFile(path.join(soxDir, name), TWENTY_CHUNKS);
        await writeFile(path.join(poolDir, name), TWENTY_CHUNKS);
      }
    });

    afterEach(async () => {
      if (savedWorkerCount === undefined) {
        delete process.env.CHIRO_WORKER_COUNT;
      } else {
        process.env.CHIRO_WORKER_COUNT = savedWorkerCount;
      }
      await rm(soxDir, { recursive: true, force: true });
      await rm(poolDir, { recursive: true, force: true });
    });

    const abortOnChunkOfSecondRecording =
      (controller: AbortController, chunkIndex: number) =>
      (event: ProgressEvent): void => {
        if (
          event.kind === "chunk-written" &&
          event.fileIndex === 1 &&
          event.chunkIndex === chunkIndex
        ) {
          controller.abort();
        }
      };

    const runBothAbortingAt = async (
      chunkIndex: number,
    ): Promise<{ sox: ProcessResult; pool: ProcessResult }> => {
      const soxAbort = new AbortController();
      const sox = await processWavFiles(
        RECORDINGS,
        soxDir,
        { mode: "preserve" },
        {
          sox: { binPath: SOX_BIN ?? "" },
          signal: soxAbort.signal,
          onProgress: abortOnChunkOfSecondRecording(soxAbort, chunkIndex),
        },
      );
      const poolAbort = new AbortController();
      const pool = await processWavFiles(
        RECORDINGS,
        poolDir,
        { mode: "preserve" },
        {
          signal: poolAbort.signal,
          onProgress: abortOnChunkOfSecondRecording(poolAbort, chunkIndex),
        },
      );
      return { sox, pool };
    };

    it("keeps only the chunks of the recordings it announces, with either engine, when aborted mid-recording", async () => {
      const { sox, pool } = await runBothAbortingAt(0);

      expect(sox.engine).toBe("sox");
      expect(sox.interrupted).toBe(true);
      expect(pool.interrupted).toBe(true);
      expect(await listOutputs(soxDir)).toEqual(announcedChunks(sox));
      expect(await listOutputs(poolDir)).toEqual(announcedChunks(pool));
      expect(await listOutputs(poolDir)).toEqual(await listOutputs(soxDir));
    }, 60_000);

    it("keeps and counts a recording whose last chunk is written when the abort arrives, with either engine", async () => {
      const { sox, pool } = await runBothAbortingAt(19);

      expect(sox.engine).toBe("sox");
      expect(sox.interrupted).toBe(true);
      expect(pool.interrupted).toBe(true);
      expect(sox.processed.map((p) => p.sourceFile).sort()).toEqual(RECORDINGS);
      expect(pool.processed.map((p) => p.sourceFile).sort()).toEqual(
        RECORDINGS,
      );
      expect(await listOutputs(soxDir)).toHaveLength(40);
      expect(await listOutputs(soxDir)).toEqual(announcedChunks(sox));
      expect(await listOutputs(poolDir)).toEqual(await listOutputs(soxDir));
    }, 60_000);
  },
);
