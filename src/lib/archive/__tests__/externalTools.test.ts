import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArchiveEntryStat } from "../planArchive.js";
import { createZipArchive } from "../createZipArchive.js";

const findBin = (name: string): string | null => {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

const UNZIP_BIN = findBin("unzip");
const PYTHON_BIN = findBin("python3");
const BSDTAR_BIN = findBin("bsdtar");

const isCi = process.env.CI !== undefined && process.env.CI !== "";

/**
 * Registers a `describe` block that exercises a real extractor binary.
 * Locally, a missing tool just skips the block. In CI, every tool below is
 * expected to be installed by the workflow — a missing one there means the
 * CI image regressed, so it's a hard failure rather than a silent skip.
 */
const describeWithTool = (
  bin: string | null,
  label: string,
  registerTests: (bin: string) => void,
): void => {
  if (bin !== null) {
    describe(label, () => {
      registerTests(bin);
    });
    return;
  }
  if (isCi) {
    describe(label, () => {
      it("must be installed in CI", () => {
        throw new Error(`${label}: binary not found on PATH in CI`);
      });
    });
    return;
  }
  describe.skip(label, () => {
    it("skipped locally — binary not found on PATH", () => {
      // Intentionally empty — describe.skip means this body never runs.
    });
  });
};

let tmpDir: string;
let sourceDir: string;
let archivedDir: string;
let zipPath: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-test-exttools-"));
  sourceDir = path.join(tmpDir, "processed");
  archivedDir = path.join(tmpDir, "archived");
  await mkdir(sourceDir, { recursive: true });

  const entries: ArchiveEntryStat[] = [];
  for (const [name, content] of [
    ["a_001.wav", "first chunk content"],
    ["b_002.wav", "second chunk content, a bit longer this time"],
    ["café_003.wav", "accented name chunk"],
  ] as const) {
    const abs = path.join(sourceDir, name);
    await writeFile(abs, content);
    const stats = await stat(abs);
    entries.push({ name, size: stats.size, mtime: stats.mtime });
  }

  zipPath = path.join(archivedDir, "processed_exttools.zip");
  const result = await createZipArchive({ sourceDir, entries, zipPath });
  expect(result.kind).toBe("ok");
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describeWithTool(UNZIP_BIN, "real extractor — unzip -t", (bin) => {
  it("validates the archive with no errors", () => {
    const proc = spawnSync(bin, ["-tqq", zipPath], {
      maxBuffer: 10 * 1024 * 1024,
    });
    expect(proc.status).toBe(0);
  });
});

describeWithTool(
  PYTHON_BIN,
  "real extractor — python3 -m zipfile -t",
  (bin) => {
    it("validates the archive with no errors", () => {
      const proc = spawnSync(bin, ["-m", "zipfile", "-t", zipPath], {
        maxBuffer: 10 * 1024 * 1024,
      });
      expect(proc.status).toBe(0);
    });

    it("reports extract_version 20 for every entry", () => {
      const script = [
        "import sys, zipfile",
        "zf = zipfile.ZipFile(sys.argv[1])",
        "ok = all(i.extract_version == 20 for i in zf.infolist())",
        "print('EXTRACT_VERSION_OK' if ok else 'EXTRACT_VERSION_BAD')",
      ].join("\n");
      const proc = spawnSync(bin, ["-c", script, zipPath], {
        maxBuffer: 10 * 1024 * 1024,
      });
      expect(proc.status).toBe(0);
      expect((proc.stdout?.toString("utf8") ?? "").trim()).toBe(
        "EXTRACT_VERSION_OK",
      );
    });
  },
);

describeWithTool(BSDTAR_BIN, "real extractor — bsdtar -tf", (bin) => {
  it("lists all three entries with no errors", () => {
    const proc = spawnSync(bin, ["-tf", zipPath], {
      maxBuffer: 10 * 1024 * 1024,
    });
    expect(proc.status).toBe(0);
    const listed = (proc.stdout?.toString("utf8") ?? "").trim().split("\n");
    expect(listed).toHaveLength(3);
  });
});
