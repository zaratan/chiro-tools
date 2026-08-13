import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArchiveEntryStat } from "../planArchive.js";
import { createZipArchive } from "../createZipArchive.js";

// Timestamps are stored as DOS local time (`toDosDateTime`) — pinning TZ is
// required for this snapshot to be stable across CI (UTC) and a developer
// machine (whatever local zone they're in). `Date.UTC` (not the local-
// component constructor) fixes the underlying instant regardless of the
// *ambient* TZ this test file happens to be imported under — `vi.stubEnv`
// only needs to make later `.getHours()`-style reads of that fixed instant
// deterministic, which it reliably does.
const FIXED_MTIME = new Date(Date.UTC(2026, 7, 12, 14, 30, 0));

let tmpDir: string;
let sourceDir: string;
let archivedDir: string;

describe("createZipArchive — golden byte-for-byte snapshot", () => {
  beforeEach(async () => {
    vi.stubEnv("TZ", "UTC");
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-test-golden-"));
    sourceDir = path.join(tmpDir, "processed");
    archivedDir = path.join(tmpDir, "archived");
    await mkdir(sourceDir, { recursive: true });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("produces byte-identical output for fixed content, names, and mtimes", async () => {
    const entries: ArchiveEntryStat[] = [];
    for (const [name, content] of [
      ["a_001.wav", "RIFF-ish content of the first chunk"],
      ["b_002.wav", "second chunk, slightly different content"],
    ] as const) {
      const abs = path.join(sourceDir, name);
      await writeFile(abs, content);
      await utimes(abs, FIXED_MTIME, FIXED_MTIME);
      const stats = await stat(abs);
      entries.push({ name, size: stats.size, mtime: stats.mtime });
    }

    const zipPath = path.join(archivedDir, "processed_golden.zip");
    const result = await createZipArchive({ sourceDir, entries, zipPath });
    expect(result.kind).toBe("ok");

    const zipBytes = await readFile(zipPath);
    expect(zipBytes.toString("hex")).toMatchSnapshot();
  });
});
