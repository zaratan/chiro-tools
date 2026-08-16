import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArchiveEntryStat } from "../../../lib/archive/planArchive.js";
import type { CreateZipArchiveFn } from "../backupBehavior.js";
import { createBackupBehavior } from "../backupBehavior.js";

let tmpDir: string;
let processedDir: string;
let archivedDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-test-backup-behavior-"));
  processedDir = path.join(tmpDir, "processed");
  archivedDir = path.join(tmpDir, "archived");
  await mkdir(processedDir, { recursive: true });
  await mkdir(archivedDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const entries: ArchiveEntryStat[] = [
  { name: "a_001.wav", size: 4, mtime: new Date("2026-01-01T00:00:00Z") },
];

/** A writer stub that reports whatever `durable` the test asks for. */
const writerReporting =
  (durable: boolean): CreateZipArchiveFn =>
  (opts) =>
    Promise.resolve({
      kind: "ok" as const,
      zipPath: opts.zipPath,
      zipBytes: 100,
      entryCount: 1,
      durationMs: 1,
      durable,
      archivedNames: ["a_001.wav"],
    });

const runBehavior = async (durable: boolean) => {
  const behavior = createBackupBehavior(
    processedDir,
    archivedDir,
    entries,
    writerReporting(durable),
  );
  return behavior.runner({
    entries,
    signal: new AbortController().signal,
    onProgress: () => undefined,
  });
};

describe("createBackupBehavior — durable propagation", () => {
  /**
   * The type system guarantees `durable` is *present* (it is a required field
   * since the phase-9 review). It cannot guarantee the value is the writer's
   * rather than a hard-coded `true` — which is exactly the mutation that
   * survived on the package side. The backup zip is the artifact a future
   * flow would upload and then delete the source of, so this is the flag
   * that must not lie.
   */
  it.each([true, false])(
    "carries the writer's durable=%s through to the run outcome",
    async (durable) => {
      const result = await runBehavior(durable);

      expect(result.kind).toBe("backup-ok");
      if (result.kind !== "backup-ok") throw new Error("type narrowing");
      expect(result.durable).toBe(durable);
    },
  );
});
