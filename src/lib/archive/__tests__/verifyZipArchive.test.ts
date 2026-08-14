import { mkdir, mkdtemp, open, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArchiveEntryStat } from "../planArchive.js";
import { createZipArchive } from "../createZipArchive.js";
import { CRC32_INITIAL, crc32Final, crc32Update } from "../crc32.js";
import {
  verifyZipArchive,
  type ArchivePlanEntry,
} from "../verifyZipArchive.js";
import {
  buildCentralDirectoryEntry,
  buildEndOfCentralDirectory,
  buildLocalFileHeader,
  buildLocalFileHeaderPatch,
  buildZip64EndOfCentralDirectory,
  buildZip64EndOfCentralDirectoryLocator,
  CD_FIXED_SIZE,
  CRC_FIELD_OFFSET,
  EOCD_FIXED_SIZE,
  LFH_FIXED_SIZE,
  MAX_UINT16,
  MAX_UINT32,
  nameBytesOf,
} from "../zipFormat.js";

let tmpDir: string;
let sourceDir: string;
let archivedDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-test-verify-"));
  sourceDir = path.join(tmpDir, "processed");
  archivedDir = path.join(tmpDir, "archived");
  await mkdir(sourceDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/** Builds a real, valid archive (via `createZipArchive`) with the given
 * name/content entries, and returns its path plus the plan that describes
 * it — a solid baseline to then apply targeted byte-level corruption to. */
const buildRealArchive = async (
  files: readonly (readonly [string, string])[],
  opts?: { zip64Thresholds?: { offset?: number } },
): Promise<{ zipPath: string; plan: ArchivePlanEntry[] }> => {
  const entries: ArchiveEntryStat[] = [];
  for (const [name, content] of files) {
    const abs = path.join(sourceDir, name);
    await writeFile(abs, content);
    const stats = await stat(abs);
    entries.push({ name, size: stats.size, mtime: stats.mtime });
  }
  const zipPath = path.join(archivedDir, "processed_verify.zip");
  const result = await createZipArchive({
    sourceDir,
    entries,
    zipPath,
    zip64Thresholds: opts?.zip64Thresholds,
  });
  if (result.kind !== "ok")
    throw new Error(`fixture setup failed: ${result.kind}`);

  const plan = files.map(([name], i) => ({
    name,
    uncompressedSize: entries[i]?.size ?? 0,
  }));
  return { zipPath, plan };
};

const patchBytes = async (
  filePath: string,
  offset: number,
  bytes: Buffer,
): Promise<void> => {
  const fh = await open(filePath, "r+");
  try {
    await fh.write(bytes, 0, bytes.length, offset);
  } finally {
    await fh.close();
  }
};

describe("verifyZipArchive — happy path", () => {
  it("returns ok for a valid, freshly-created archive", async () => {
    const { zipPath, plan } = await buildRealArchive([
      ["a_001.wav", "content of a"],
      ["b_002.wav", "content of b, a little longer"],
    ]);
    const result = await verifyZipArchive(zipPath, plan, { crcMode: "spot" });
    expect(result).toEqual({ kind: "ok" });
  });

  it("returns ok with crcMode full, checking every entry", async () => {
    const { zipPath, plan } = await buildRealArchive([
      ["a.wav", "x"],
      ["b.wav", "y"],
      ["c.wav", "z"],
    ]);
    const result = await verifyZipArchive(zipPath, plan, { crcMode: "full" });
    expect(result).toEqual({ kind: "ok" });
  });

  it("returns ok for a zero-entry archive (pickCrcCheckIndices empty-entry branch)", async () => {
    const zipPath = path.join(archivedDir, "processed_empty.zip");
    const result = await createZipArchive({ sourceDir, entries: [], zipPath });
    expect(result).toEqual({
      kind: "ok",
      zipPath,
      zipBytes: EOCD_FIXED_SIZE,
      entryCount: 0,
      durationMs: expect.any(Number) as number,
      durable: expect.any(Boolean) as boolean,
    });
    const verifyResult = await verifyZipArchive(zipPath, [], {
      crcMode: "spot",
    });
    expect(verifyResult).toEqual({ kind: "ok" });
  });
});

describe("verifyZipArchive — file-level failures", () => {
  it("fails with file-too-small on a file shorter than an EOCD record", async () => {
    const zipPath = path.join(tmpDir, "tiny.zip");
    await writeFile(zipPath, Buffer.alloc(10));
    const result = await verifyZipArchive(zipPath, [], { crcMode: "spot" });
    expect(result).toEqual({ kind: "verify-failed", reason: "file-too-small" });
  });

  it("fails with eocd-signature-mismatch when the EOCD signature is corrupted", async () => {
    const { zipPath, plan } = await buildRealArchive([["a.wav", "content"]]);
    const stats = await stat(zipPath);
    await patchBytes(
      zipPath,
      stats.size - EOCD_FIXED_SIZE,
      Buffer.from([0, 0, 0, 0]),
    );
    const result = await verifyZipArchive(zipPath, plan, { crcMode: "spot" });
    expect(result).toEqual({
      kind: "verify-failed",
      reason: "eocd-signature-mismatch",
    });
  });
});

describe("verifyZipArchive — completeness against the plan", () => {
  it("fails with entry-count-mismatch when the plan has a different length than the archive", async () => {
    const { zipPath, plan } = await buildRealArchive([
      ["a.wav", "content a"],
      ["b.wav", "content b"],
    ]);
    const result = await verifyZipArchive(zipPath, plan.slice(0, 1), {
      crcMode: "spot",
    });
    expect(result).toEqual({
      kind: "verify-failed",
      reason: "entry-count-mismatch",
    });
  });

  it("fails with entry-set-mismatch when a plan entry's size doesn't match the archive", async () => {
    const { zipPath, plan } = await buildRealArchive([["a.wav", "content a"]]);
    const tamperedPlan = plan.map((e) => ({
      ...e,
      uncompressedSize: e.uncompressedSize + 1,
    }));
    const result = await verifyZipArchive(zipPath, tamperedPlan, {
      crcMode: "spot",
    });
    expect(result).toEqual({
      kind: "verify-failed",
      reason: "entry-set-mismatch",
    });
  });

  it("fails with entry-set-mismatch when a plan entry's name doesn't match the archive", async () => {
    const { zipPath, plan } = await buildRealArchive([["a.wav", "content a"]]);
    const tamperedPlan = plan.map((e) => ({ ...e, name: "different.wav" }));
    const result = await verifyZipArchive(zipPath, tamperedPlan, {
      crcMode: "spot",
    });
    expect(result).toEqual({
      kind: "verify-failed",
      reason: "entry-set-mismatch",
    });
  });
});

describe("verifyZipArchive — central directory parsing", () => {
  it("fails with cd-signature-mismatch when a CD entry's signature is corrupted", async () => {
    const { zipPath, plan } = await buildRealArchive([["a.wav", "content"]]);
    // The single entry's CD record starts right after the LFH+data — same
    // offset the writer itself tracked as `cdOffset`. We don't have that
    // value directly here, so locate it by re-deriving it the same way the
    // fixture's own single-entry archive lays things out: LFH(30+name) +
    // deflated payload. Simplest robust anchor: read the EOCD's cdOffset
    // field directly.
    const stats = await stat(zipPath);
    const fh = await open(zipPath, "r");
    const eocdBuf = Buffer.alloc(EOCD_FIXED_SIZE);
    await fh.read(eocdBuf, 0, EOCD_FIXED_SIZE, stats.size - EOCD_FIXED_SIZE);
    const cdOffset = eocdBuf.readUInt32LE(16);
    await fh.close();

    await patchBytes(zipPath, cdOffset, Buffer.from([0xff, 0xff, 0xff, 0xff]));
    const result = await verifyZipArchive(zipPath, plan, { crcMode: "spot" });
    expect(result).toEqual({
      kind: "verify-failed",
      reason: "cd-signature-mismatch",
    });
  });

  it("fails with cd-truncated when the EOCD claims more entries than the CD actually holds", async () => {
    const { zipPath } = await buildRealArchive([["a.wav", "content"]]);
    const stats = await stat(zipPath);
    const eocdOffset = stats.size - EOCD_FIXED_SIZE;

    // Bump the classic EOCD's entry-count fields (both copies, offsets 8
    // and 10) from 1 to 2 without touching cdSize — the parser will run out
    // of room for the phantom second entry before it runs out of `cdBuf`.
    await patchBytes(zipPath, eocdOffset + 8, Buffer.from([0x02, 0x00]));
    await patchBytes(zipPath, eocdOffset + 10, Buffer.from([0x02, 0x00]));

    // The plan's length must match the (corrupted) entryCount to get past
    // the entry-count-mismatch check and reach CD parsing.
    const fakePlan: ArchivePlanEntry[] = [
      { name: "a.wav", uncompressedSize: 7 },
      { name: "b.wav", uncompressedSize: 7 },
    ];
    const result = await verifyZipArchive(zipPath, fakePlan, {
      crcMode: "spot",
    });
    expect(result).toEqual({ kind: "verify-failed", reason: "cd-truncated" });
  });

  it("fails with cd-truncated when a CD entry's declared name length overruns the CD buffer", async () => {
    const { zipPath, plan } = await buildRealArchive([["a.wav", "content"]]);
    const stats = await stat(zipPath);
    const fh = await open(zipPath, "r");
    const eocdBuf = Buffer.alloc(EOCD_FIXED_SIZE);
    await fh.read(eocdBuf, 0, EOCD_FIXED_SIZE, stats.size - EOCD_FIXED_SIZE);
    const cdOffset = eocdBuf.readUInt32LE(16);
    await fh.close();

    // The fixed 46-byte CD header still fits, but claiming a name far longer
    // than the (unchanged, small) `cdSize` leaves no room for it.
    const bogusNameLen = Buffer.alloc(2);
    bogusNameLen.writeUInt16LE(60_000, 0);
    await patchBytes(zipPath, cdOffset + 28, bogusNameLen);

    const result = await verifyZipArchive(zipPath, plan, { crcMode: "spot" });
    expect(result).toEqual({ kind: "verify-failed", reason: "cd-truncated" });
  });
});

describe("verifyZipArchive — local file header structural checks", () => {
  it("fails with lfh-signature-mismatch when the first entry's LFH signature is corrupted", async () => {
    const { zipPath, plan } = await buildRealArchive([["a.wav", "content"]]);
    // The first entry is always written at offset 0.
    await patchBytes(zipPath, 0, Buffer.from([0, 0, 0, 0]));
    const result = await verifyZipArchive(zipPath, plan, { crcMode: "spot" });
    expect(result).toEqual({
      kind: "verify-failed",
      reason: "lfh-signature-mismatch",
    });
  });

  it("fails with lfh-name-mismatch when the LFH's stored name bytes are corrupted", async () => {
    const { zipPath, plan } = await buildRealArchive([
      ["axxxx.wav", "content"],
    ]);
    // Name bytes start right after the 30-byte fixed LFH header at offset 0.
    await patchBytes(zipPath, LFH_FIXED_SIZE, Buffer.from("Z"));
    const result = await verifyZipArchive(zipPath, plan, { crcMode: "spot" });
    expect(result).toEqual({
      kind: "verify-failed",
      reason: "lfh-name-mismatch",
    });
  });

  it("fails with lfh-patch-mismatch when the LFH's patched CRC field disagrees with the CD", async () => {
    const { zipPath, plan } = await buildRealArchive([["a.wav", "content"]]);
    // The 12-byte patch (crc32, compressedSize, uncompressedSize) sits at
    // CRC_FIELD_OFFSET within the first entry's LFH (offset 0). Flipping a
    // byte inside it desyncs it from what's recorded in the CD, without
    // touching the actual compressed data or the CD itself.
    await patchBytes(zipPath, CRC_FIELD_OFFSET, Buffer.from([0xff]));
    const result = await verifyZipArchive(zipPath, plan, { crcMode: "spot" });
    expect(result).toEqual({
      kind: "verify-failed",
      reason: "lfh-patch-mismatch",
    });
  });

  it("fails with contiguity-mismatch when an entry's declared compressed size doesn't match the real gap to the next entry", async () => {
    const { zipPath, plan } = await buildRealArchive([
      ["a.wav", "content of a, first entry"],
      ["b.wav", "content of b, second entry"],
    ]);
    const stats = await stat(zipPath);
    const eocdOffset = stats.size - EOCD_FIXED_SIZE;
    const fh = await open(zipPath, "r");
    const eocdBuf = Buffer.alloc(EOCD_FIXED_SIZE);
    await fh.read(eocdBuf, 0, EOCD_FIXED_SIZE, eocdOffset);
    const cdOffset = eocdBuf.readUInt32LE(16);
    await fh.close();

    // Shrink entry 0's *declared* compressed size by 1, consistently in
    // both places verify cross-checks against each other (the CD's own
    // field, and the LFH's independently-read patch) — so the patch check
    // still agrees with the (now jointly wrong) CD value, and only the
    // physical gap to entry 1's real, unmoved offset is left inconsistent.
    const cdEntryBuf = Buffer.alloc(4);
    const fh2 = await open(zipPath, "r");
    await fh2.read(cdEntryBuf, 0, 4, cdOffset + 20); // CD compressedSize field
    await fh2.close();
    const wrongCompressedSize = cdEntryBuf.readUInt32LE(0) - 1;
    const wrongBuf = Buffer.alloc(4);
    wrongBuf.writeUInt32LE(wrongCompressedSize, 0);

    await patchBytes(zipPath, cdOffset + 20, wrongBuf); // CD copy
    await patchBytes(zipPath, CRC_FIELD_OFFSET + 4, wrongBuf); // LFH patch copy (entry 0 at offset 0)

    const result = await verifyZipArchive(zipPath, plan, { crcMode: "spot" });
    expect(result).toEqual({
      kind: "verify-failed",
      reason: "contiguity-mismatch",
    });
  });
});

describe("verifyZipArchive — ZIP64", () => {
  it("fails with zip64-extra-missing when a saturated offset's ZIP64 extra field tag is corrupted", async () => {
    const { zipPath, plan } = await buildRealArchive(
      [
        ["a.wav", "content a"],
        ["b.wav", "content b"],
      ],
      { zip64Thresholds: { offset: 1 } }, // forces entry 1+ into the ZIP64 offset path
    );
    const stats = await stat(zipPath);
    const fh = await open(zipPath, "r");
    const eocdBuf = Buffer.alloc(EOCD_FIXED_SIZE);
    await fh.read(eocdBuf, 0, EOCD_FIXED_SIZE, stats.size - EOCD_FIXED_SIZE);
    const cdOffset = eocdBuf.readUInt32LE(16);

    // Walk to the second CD entry (first one starts at cdOffset) to find its
    // ZIP64 extra field's 2-byte tag, then corrupt it.
    const firstFixed = Buffer.alloc(CD_FIXED_SIZE);
    await fh.read(firstFixed, 0, CD_FIXED_SIZE, cdOffset);
    const firstNameLen = firstFixed.readUInt16LE(28);
    const firstExtraLen = firstFixed.readUInt16LE(30);
    const secondOffset =
      cdOffset + CD_FIXED_SIZE + firstNameLen + firstExtraLen;
    const secondFixed = Buffer.alloc(CD_FIXED_SIZE);
    await fh.read(secondFixed, 0, CD_FIXED_SIZE, secondOffset);
    const secondNameLen = secondFixed.readUInt16LE(28);
    await fh.close();

    const tagOffset = secondOffset + CD_FIXED_SIZE + secondNameLen;
    await patchBytes(zipPath, tagOffset, Buffer.from([0x99, 0x99]));

    const result = await verifyZipArchive(zipPath, plan, { crcMode: "spot" });
    expect(result).toEqual({
      kind: "verify-failed",
      reason: "zip64-extra-missing",
    });
  });

  it("fails with zip64-locator-missing when the classic EOCD claims saturation but the file is too short for a locator", async () => {
    const zipPath = path.join(tmpDir, "fake-saturated.zip");
    const eocd = buildEndOfCentralDirectory({
      entryCount: MAX_UINT16,
      cdSize: 100,
      cdOffset: 200,
    });
    await writeFile(zipPath, eocd); // exactly EOCD_FIXED_SIZE bytes, no room for a locator before it
    const result = await verifyZipArchive(zipPath, [], { crcMode: "spot" });
    expect(result).toEqual({
      kind: "verify-failed",
      reason: "zip64-locator-missing",
    });
  });

  it("fails with zip64-locator-signature-mismatch when the locator's signature is wrong", async () => {
    const zipPath = path.join(tmpDir, "fake-bad-locator.zip");
    const badLocator = Buffer.alloc(20); // all zero — not the locator signature
    const eocd = buildEndOfCentralDirectory({
      entryCount: MAX_UINT16,
      cdSize: 100,
      cdOffset: 200,
    });
    await writeFile(zipPath, Buffer.concat([badLocator, eocd]));
    const result = await verifyZipArchive(zipPath, [], { crcMode: "spot" });
    expect(result).toEqual({
      kind: "verify-failed",
      reason: "zip64-locator-signature-mismatch",
    });
  });

  it("fails with zip64-eocd-signature-mismatch when the ZIP64 EOCD record's signature is wrong", async () => {
    const zipPath = path.join(tmpDir, "fake-bad-zip64eocd.zip");
    const fakeZip64Eocd = Buffer.alloc(56, 0xaa); // garbage, wrong signature
    const locator = buildZip64EndOfCentralDirectoryLocator(0); // points at offset 0
    const eocd = buildEndOfCentralDirectory({
      entryCount: MAX_UINT16,
      cdSize: 100,
      cdOffset: 200,
    });
    await writeFile(zipPath, Buffer.concat([fakeZip64Eocd, locator, eocd]));
    const result = await verifyZipArchive(zipPath, [], { crcMode: "spot" });
    expect(result).toEqual({
      kind: "verify-failed",
      reason: "zip64-eocd-signature-mismatch",
    });
  });

  it("reads the real entryCount/cdSize/cdOffset from a genuine ZIP64 EOCD record and verifies successfully", async () => {
    // Real 65 536+ entry / 4 GiB archives are impractical in a unit test —
    // this hand-assembles a tiny, structurally valid archive whose *classic*
    // EOCD is deliberately marked saturated (as it genuinely would be for a
    // 65 536-entry archive), forcing verify down the same
    // read-the-ZIP64-record path a real oversized archive would take, while
    // the record itself truthfully describes the one small entry present.
    const name = "a.wav";
    const content = Buffer.from("hello zip64");
    const nameBytes = nameBytesOf(name);
    const compressed = deflateRawSync(content);
    const crc32 = crc32Final(crc32Update(CRC32_INITIAL, content));

    const lfh = buildLocalFileHeader({
      nameBytes,
      modified: new Date(2026, 0, 1),
      crc32: 0,
      compressedSize: 0,
      uncompressedSize: 0,
    });
    const patch = buildLocalFileHeaderPatch(
      crc32,
      compressed.length,
      content.length,
    );
    lfh.set(patch, CRC_FIELD_OFFSET);

    const cdOffset = lfh.length + compressed.length;
    const cdEntry = buildCentralDirectoryEntry({
      nameBytes,
      modified: new Date(2026, 0, 1),
      crc32,
      compressedSize: compressed.length,
      uncompressedSize: content.length,
      localHeaderOffset: 0,
      zip64OffsetThreshold: MAX_UINT32, // no per-entry ZIP64 needed here
    });
    const cdSize = cdEntry.length;

    const zip64EocdOffset = cdOffset + cdSize;
    const zip64Eocd = buildZip64EndOfCentralDirectory({
      entryCount: 1,
      cdSize,
      cdOffset,
    });
    const locator = buildZip64EndOfCentralDirectoryLocator(zip64EocdOffset);
    const classicEocd = buildEndOfCentralDirectory({
      entryCount: MAX_UINT16, // forces `isSaturated` even though there's only 1 real entry
      cdSize,
      cdOffset,
    });

    const zipPath = path.join(tmpDir, "hand-crafted-zip64.zip");
    await writeFile(
      zipPath,
      Buffer.concat([
        lfh,
        compressed,
        cdEntry,
        zip64Eocd,
        locator,
        classicEocd,
      ]),
    );

    const result = await verifyZipArchive(
      zipPath,
      [{ name, uncompressedSize: content.length }],
      { crcMode: "full" },
    );
    expect(result).toEqual({ kind: "ok" });
  });
});

describe("verifyZipArchive — data integrity", () => {
  it("fails with crc-mismatch when an entry's compressed data is corrupted but its structure is intact", async () => {
    const { zipPath, plan } = await buildRealArchive([
      [
        "a.wav",
        "content that compresses to more than a couple bytes, repeated ".repeat(
          10,
        ),
      ],
    ]);
    // Land inside the compressed data region (after the 30-byte LFH + short
    // name) and flip one bit deep enough into the Huffman-coded payload that
    // the deflate stream is still syntactically valid — just decodes to
    // different bytes. (Empirically verified against this exact fixture:
    // dataStart + 31 always still inflates cleanly to the wrong content,
    // unlike bytes very close to either end of the stream.)
    const dataStart = LFH_FIXED_SIZE + "a.wav".length;
    const corruptOffset = dataStart + 31;
    const fh = await open(zipPath, "r");
    const targetByte = Buffer.alloc(1);
    await fh.read(targetByte, 0, 1, corruptOffset);
    await fh.close();
    targetByte[0] = (targetByte[0] ?? 0) ^ 0x01;
    await patchBytes(zipPath, corruptOffset, targetByte);

    const result = await verifyZipArchive(zipPath, plan, { crcMode: "full" });
    expect(result.kind).toBe("verify-failed");
    if (result.kind !== "verify-failed") throw new Error("type narrowing");
    expect(result.reason).toMatch(/^crc-mismatch:/);
  });

  it("fails with read-error when an entry's compressed data isn't a valid deflate stream at all", async () => {
    const { zipPath, plan } = await buildRealArchive([
      ["a.wav", "some content here"],
    ]);
    const dataStart = LFH_FIXED_SIZE + "a.wav".length;
    // Overwrite with bytes deflate can't parse as a raw stream at all,
    // rather than merely different-but-valid compressed content.
    await patchBytes(
      zipPath,
      dataStart,
      Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff]),
    );
    const result = await verifyZipArchive(zipPath, plan, { crcMode: "full" });
    expect(result).toEqual({ kind: "verify-failed", reason: "read-error" });
  });
});
