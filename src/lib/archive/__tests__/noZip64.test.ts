// Exact on-disk layout of a volume series: every byte written is accounted
// for by a known structure (`onDiskSize === Σ structures + EOCD`), and no
// ZIP64 record appears — checked structurally via the extended `readZip`,
// never by scanning for magic bytes, since a deflate stream can legitimately
// contain `50 4B 06 06`.
//
// This is NOT the proof that `zip64: "forbid"` works: nothing here passes
// that option, and every assertion below would still hold if the mode were
// deleted from the codebase (the thresholds are 65 535 entries / 4 GiB,
// which volumes of a few KiB cannot approach). That guarantee is covered,
// and discriminatingly so, by `createZipVolumes.test.ts` ("forwards
// zip64Thresholds") and `zip64.test.ts` (injected thresholds). What this
// file uniquely catches is an accounting drift in the volume-admission
// arithmetic — drop `priorCdBytes` or `EOCD_FIXED_SIZE` and it goes red.
//
// Calls `createZipArchive` directly in a loop rather than the orchestrator:
// deliberate, so it keeps testing the writer's own layout guarantee.
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArchiveEntryStat } from "../planArchive.js";
import { createZipArchive } from "../createZipArchive.js";
import { readZip, type ReadZipResult } from "./zipTestReader.js";
import {
  CD_FIXED_SIZE,
  EOCD_FIXED_SIZE,
  LFH_FIXED_SIZE,
  MAX_UINT16,
  MAX_UINT32,
  nameBytesOf,
  VERSION_NEEDED_DEFAULT,
} from "../zipFormat.js";

let tmpDir: string;
let sourceDir: string;
let archivedDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-test-nozip64-"));
  sourceDir = path.join(tmpDir, "processed");
  archivedDir = path.join(tmpDir, "archived");
  await mkdir(sourceDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const FILE_COUNT = 40;
const MAX_BYTES = 18 * 1024;

/**
 * Deterministic, effectively-incompressible bytes — repeated SHA-256
 * digests of a seeded counter. Plain repeated-byte content would deflate
 * down to almost nothing, keeping the archive's real on-disk size far below
 * `maxBytes` for all 40 entries and defeating the point of this test (it
 * needs several volumes, not one).
 */
const pseudoRandomBytes = (seed: number, length: number): Buffer => {
  const chunks: Buffer[] = [];
  let total = 0;
  let counter = 0;
  while (total < length) {
    const digest = createHash("sha256")
      .update(`nozip64-${seed.toString()}-${counter.toString()}`)
      .digest();
    chunks.push(digest);
    total += digest.length;
    counter++;
  }
  return Buffer.concat(chunks).subarray(0, length);
};

const buildEntries = async (): Promise<ArchiveEntryStat[]> => {
  const entries: ArchiveEntryStat[] = [];
  for (let i = 0; i < FILE_COUNT; i++) {
    const name = `e${i.toString().padStart(3, "0")}.wav`;
    // Deterministic, varying size (roughly 100–2000 bytes) — not about
    // compression ratios, just needs to be reproducible.
    const size = 100 + ((i * 47) % 1900);
    const content = pseudoRandomBytes(i, size);
    const abs = path.join(sourceDir, name);
    await writeFile(abs, content);
    const stats = await stat(abs);
    entries.push({ name, size: stats.size, mtime: stats.mtime });
  }
  return entries;
};

describe("createZipArchive — maxBytes, ZIP64-free volumes", () => {
  it("splits into multiple volumes, none of which contain any ZIP64 structure", async () => {
    const entries = await buildEntries();

    let remaining: ArchiveEntryStat[] = entries;
    let volumeIndex = 1;
    const volumePaths: string[] = [];

    for (;;) {
      const zipPath = path.join(
        archivedDir,
        `vol${volumeIndex.toString()}.zip`,
      );
      const result = await createZipArchive({
        sourceDir,
        entries: remaining,
        zipPath,
        maxBytes: MAX_BYTES,
      });
      volumePaths.push(zipPath);
      if (result.kind === "ok") break;
      if (result.kind !== "volume-full") {
        throw new Error(`unexpected result: ${JSON.stringify(result)}`);
      }
      remaining = remaining.slice(result.entriesWritten);
      volumeIndex++;
    }

    // The split is meaningful for this test to be worth anything.
    expect(volumePaths.length).toBeGreaterThanOrEqual(3);

    const parsedVolumes: ReadZipResult[] = [];
    for (const zipPath of volumePaths) {
      const parsed = await readZip(zipPath);
      parsedVolumes.push(parsed);

      for (const entry of parsed.entries) {
        expect(entry.versionNeeded).toBe(VERSION_NEEDED_DEFAULT);
        expect(entry.extraLength).toBe(0);
      }
      expect(parsed.hasZip64Eocd).toBe(false);
      expect(parsed.hasZip64Locator).toBe(false);
      expect(parsed.rawEocd.entryCount).not.toBe(MAX_UINT16);
      expect(parsed.rawEocd.cdSize).not.toBe(MAX_UINT32);
      expect(parsed.rawEocd.cdOffset).not.toBe(MAX_UINT32);

      const onDiskSize = (await stat(zipPath)).size;
      expect(onDiskSize).toBeLessThanOrEqual(MAX_BYTES);

      // Strict layout equality — no unaccounted-for bytes.
      const expectedZipBytes =
        parsed.entries.reduce(
          (sum, entry) =>
            sum +
            LFH_FIXED_SIZE +
            CD_FIXED_SIZE +
            2 * nameBytesOf(entry.name).length +
            entry.compressedSize,
          0,
        ) + EOCD_FIXED_SIZE;
      expect(onDiskSize).toBe(expectedZipBytes);
    }

    // Every original name appears exactly once across the whole series, in
    // the original alphabetical scan order.
    const allNames = parsedVolumes.flatMap((v) => v.entries.map((e) => e.name));
    expect(allNames).toEqual(entries.map((e) => e.name));
    expect(new Set(allNames).size).toBe(entries.length);

    // Every entry's inflated data is byte-identical to its source file.
    for (const volume of parsedVolumes) {
      for (const entry of volume.entries) {
        const srcBuf = await readFile(path.join(sourceDir, entry.name));
        expect(entry.data.equals(srcBuf)).toBe(true);
      }
    }
  });
});
