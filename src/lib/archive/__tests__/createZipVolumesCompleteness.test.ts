import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArchiveEntryStat } from "../planArchive.js";
import type { CreateZipArchiveVolumeResult } from "../createZipArchive.js";

/**
 * The series-completeness guard (D5) is unreachable through the public API
 * while the writer is correct — which is precisely why it was untested:
 * disabling it with `if (false && …)` left the whole suite green. It is the
 * only thing between a bookkeeping bug in the volume loop and a published
 * series that silently omits recordings, and it is what the future
 * destructive flow is meant to rely on before deleting anything.
 *
 * So the writer is mocked here to lie about its counts. Nothing else in the
 * module is stubbed: the staging, the rename loop and the commit all run for
 * real, which is what makes the "no series is published" half of each
 * assertion meaningful.
 */
type MockedWriter = (opts: {
  zipPath: string;
}) => Promise<CreateZipArchiveVolumeResult>;

const createZipArchiveMock = vi.hoisted(() =>
  // Typed on the narrow slice of the writer's contract this file exercises,
  // rather than left as `any`: the point of these tests is that the counts
  // are wrong, so the *shape* had better be right.
  vi.fn<MockedWriter>(),
);

// `createZipVolumes` imports exactly one runtime value from this module —
// everything else it takes is a type, erased at runtime — so there is nothing
// to preserve from the original. If that ever stops being true the mock fails
// loudly ("not a function") rather than silently returning a half-module.
vi.mock("../createZipArchive.js", () => ({
  createZipArchive: createZipArchiveMock,
}));

const { createZipVolumes } = await import("../createZipVolumes.js");

let tmpDir: string;
let sourceDir: string;
let uploadDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-test-completeness-"));
  sourceDir = path.join(tmpDir, "processed");
  uploadDir = path.join(tmpDir, "upload");
  await mkdir(sourceDir, { recursive: true });
  createZipArchiveMock.mockReset();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const buildEntries = async (count: number): Promise<ArchiveEntryStat[]> => {
  const entries: ArchiveEntryStat[] = [];
  for (let i = 0; i < count; i++) {
    const name = `e${i.toString()}.wav`;
    const abs = path.join(sourceDir, name);
    await writeFile(abs, `content-${i.toString()}`);
    const stats = await stat(abs);
    entries.push({ name, size: stats.size, mtime: stats.mtime });
  }
  return entries;
};

/**
 * Only the counts vary between cases, so the mechanical fields are filled in
 * here — a real (dummy) volume on disk so the rename loop and commit run for
 * real, plus the bookkeeping the orchestrator never reads back.
 */
type WriterOutcome =
  | { kind: "ok"; entryCount: number; durable: boolean }
  | {
      kind: "volume-full";
      entriesWritten: number;
      entryCount: number;
      durable: boolean;
    };

const writerReturning =
  (outcome: WriterOutcome): MockedWriter =>
  async (opts) => {
    await writeFile(opts.zipPath, "dummy-volume");
    return { ...outcome, zipPath: opts.zipPath, zipBytes: 100, durationMs: 0 };
  };

describe("createZipVolumes — series completeness guard", () => {
  it("publishes normally when the reported counts do add up (positive control)", async () => {
    const entries = await buildEntries(2);
    createZipArchiveMock
      .mockImplementationOnce(
        writerReturning({
          kind: "volume-full",
          entriesWritten: 1,
          entryCount: 1,
          durable: true,
        }),
      )
      .mockImplementationOnce(
        writerReturning({
          kind: "ok",
          entryCount: 1,
          durable: true,
        }),
      );

    const result = await createZipVolumes({
      sourceDir,
      entries,
      uploadDir,
      seriesDirName: "depot_20260814",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("type narrowing");
    expect(result.entryCount).toBe(2);
    expect(await readdir(result.seriesDirPath)).toHaveLength(2);
  });

  it("fails verify-failed and publishes nothing when the counts don't cover the source", async () => {
    const entries = await buildEntries(2);
    createZipArchiveMock
      .mockImplementationOnce(
        writerReturning({
          kind: "volume-full",
          entriesWritten: 1,
          entryCount: 1,
          durable: true,
        }),
      )
      // Lies: says it archived nothing while the loop hands it the last entry.
      // Σ entryCount = 1 for a 2-entry source — one recording would be missing
      // from a series the result screen would call complete.
      .mockImplementationOnce(
        writerReturning({
          kind: "ok",
          entryCount: 0,
          durable: true,
        }),
      );

    const result = await createZipVolumes({
      sourceDir,
      entries,
      uploadDir,
      seriesDirName: "depot_20260814",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("type narrowing");
    expect(result.code).toBe("verify-failed");
    // Staging destroyed too: no hidden multi-GB directory left behind.
    expect(await readdir(uploadDir)).toEqual([]);
  });

  it("propagates a false durable from any single volume", async () => {
    // `durable` is load-bearing for the future destructive flow, which must
    // require `true` before deleting anything. A single non-durable volume
    // has to sink the whole series' flag.
    const entries = await buildEntries(2);
    createZipArchiveMock
      .mockImplementationOnce(
        writerReturning({
          kind: "volume-full",
          entriesWritten: 1,
          entryCount: 1,
          durable: false,
        }),
      )
      .mockImplementationOnce(
        writerReturning({
          kind: "ok",
          entryCount: 1,
          durable: true,
        }),
      );

    const result = await createZipVolumes({
      sourceDir,
      entries,
      uploadDir,
      seriesDirName: "depot_20260814",
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("type narrowing");
    expect(result.durable).toBe(false);
  });
});
