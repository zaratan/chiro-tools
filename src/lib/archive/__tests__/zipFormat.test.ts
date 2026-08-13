import { describe, expect, it } from "vitest";
import {
  buildCentralDirectoryEntry,
  buildEndOfCentralDirectory,
  buildLocalFileHeader,
  buildLocalFileHeaderPatch,
  buildZip64EndOfCentralDirectory,
  buildZip64EndOfCentralDirectoryLocator,
  buildZip64ExtraField,
  CD_FIXED_SIZE,
  CENTRAL_DIR_SIGNATURE,
  CRC_FIELD_OFFSET,
  EOCD_FIXED_SIZE,
  EOCD_SIGNATURE,
  LFH_FIXED_SIZE,
  LOCAL_FILE_HEADER_SIGNATURE,
  MAX_UINT16,
  MAX_UINT32,
  nameBytesOf,
  needsZip64Eocd,
  readZip64ExtraFieldOffset,
  toDosDateTime,
  VERSION_MADE_BY,
  VERSION_NEEDED_DEFAULT,
  VERSION_NEEDED_ZIP64,
  ZIP64_EOCD_FIXED_SIZE,
  ZIP64_EOCD_LOCATOR_SIGNATURE,
  ZIP64_EOCD_SIGNATURE,
  ZIP64_LOCATOR_FIXED_SIZE,
} from "../zipFormat.js";

describe("nameBytesOf", () => {
  it("counts UTF-8 byte length, not JS string length, for accented names", () => {
    // "é" is 1 UTF-16 code unit but 2 UTF-8 bytes.
    expect(nameBytesOf("café.wav").length).toBe(9);
    expect("café.wav".length).toBe(8);
  });
});

describe("toDosDateTime", () => {
  it("encodes a normal in-range date", () => {
    const { dosDate, dosTime } = toDosDateTime(
      new Date(2026, 7, 12, 14, 30, 0),
    );
    // dosDate = ((2026-1980)<<9) | (8<<5) | 12
    expect(dosDate).toBe(((2026 - 1980) << 9) | (8 << 5) | 12);
    // dosTime = (14<<11) | (30<<5) | 0
    expect(dosTime).toBe((14 << 11) | (30 << 5) | 0);
  });

  it("clamps a pre-1980 date to the DOS epoch (1980-01-01)", () => {
    const { dosDate, dosTime } = toDosDateTime(new Date(1979, 11, 31));
    expect(dosDate).toBe((0 << 9) | (1 << 5) | 1);
    expect(dosTime).toBe(0);
  });

  it("keeps 1980-01-01 exactly at the epoch value", () => {
    const { dosDate, dosTime } = toDosDateTime(new Date(1980, 0, 1));
    expect(dosDate).toBe((0 << 9) | (1 << 5) | 1);
    expect(dosTime).toBe(0);
  });

  it("keeps 2107-12-31 exactly at the max representable date", () => {
    const { dosDate } = toDosDateTime(new Date(2107, 11, 31));
    expect(dosDate).toBe(((2107 - 1980) << 9) | (12 << 5) | 31);
  });

  it("clamps a post-2107 date to the max representable date, never throwing", () => {
    expect(() => toDosDateTime(new Date(2108, 0, 1))).not.toThrow();
    const { dosDate } = toDosDateTime(new Date(2108, 0, 1));
    expect(dosDate).toBe(((2107 - 1980) << 9) | (12 << 5) | 31);
  });

  it("falls back to the DOS epoch for an invalid Date, never throwing", () => {
    expect(() => toDosDateTime(new Date(NaN))).not.toThrow();
    const { dosDate, dosTime } = toDosDateTime(new Date(NaN));
    expect(dosDate).toBe((0 << 9) | (1 << 5) | 1);
    expect(dosTime).toBe(0);
  });
});

describe("buildLocalFileHeader", () => {
  it("writes a header of exactly LFH_FIXED_SIZE + name length bytes", () => {
    const nameBytes = nameBytesOf("chunk_001.wav");
    const buf = buildLocalFileHeader({
      nameBytes,
      modified: new Date(2026, 0, 1),
      crc32: 0,
      compressedSize: 0,
      uncompressedSize: 0,
    });
    expect(buf.length).toBe(LFH_FIXED_SIZE + nameBytes.length);
  });

  it("writes signature, version, UTF-8 flag, deflate method, and CRC=0/sizes=0 initially", () => {
    const nameBytes = nameBytesOf("a.wav");
    const buf = buildLocalFileHeader({
      nameBytes,
      modified: new Date(2026, 0, 1),
      crc32: 0,
      compressedSize: 0,
      uncompressedSize: 0,
    });
    expect(buf.readUInt32LE(0)).toBe(LOCAL_FILE_HEADER_SIGNATURE);
    expect(buf.readUInt16LE(4)).toBe(VERSION_NEEDED_DEFAULT);
    expect(buf.readUInt16LE(6)).toBe(0x0800);
    expect(buf.readUInt16LE(8)).toBe(8); // deflate
    expect(buf.readUInt32LE(CRC_FIELD_OFFSET)).toBe(0);
    expect(buf.readUInt32LE(CRC_FIELD_OFFSET + 4)).toBe(0);
    expect(buf.readUInt32LE(CRC_FIELD_OFFSET + 8)).toBe(0);
    expect(buf.readUInt16LE(26)).toBe(nameBytes.length);
    expect(buf.readUInt16LE(28)).toBe(0); // no extra field
    expect(buf.subarray(LFH_FIXED_SIZE).toString("utf8")).toBe("a.wav");
  });

  it("never emits a ZIP64 extra field, and versionNeeded stays 20 regardless of offset", () => {
    const buf = buildLocalFileHeader({
      nameBytes: nameBytesOf("far.wav"),
      modified: new Date(2026, 0, 1),
      crc32: 0,
      compressedSize: 0,
      uncompressedSize: 0,
    });
    expect(buf.readUInt16LE(4)).toBe(VERSION_NEEDED_DEFAULT);
    expect(buf.readUInt16LE(28)).toBe(0);
  });
});

describe("buildLocalFileHeaderPatch", () => {
  it("writes exactly 12 bytes: crc32, compressedSize, uncompressedSize", () => {
    const patch = buildLocalFileHeaderPatch(0x12345678, 100, 200);
    expect(patch.length).toBe(12);
    expect(patch.readUInt32LE(0)).toBe(0x12345678);
    expect(patch.readUInt32LE(4)).toBe(100);
    expect(patch.readUInt32LE(8)).toBe(200);
  });
});

describe("buildZip64ExtraField / readZip64ExtraFieldOffset", () => {
  it("round-trips a local header offset through tag 0x0001", () => {
    const extra = buildZip64ExtraField(5_000_000_000);
    expect(extra.length).toBe(12);
    expect(extra.readUInt16LE(0)).toBe(0x0001);
    expect(extra.readUInt16LE(2)).toBe(8);
    expect(readZip64ExtraFieldOffset(extra)).toBe(5_000_000_000);
  });

  it("returns null when the tag is absent", () => {
    const other = Buffer.alloc(4);
    other.writeUInt16LE(0x9999, 0);
    other.writeUInt16LE(0, 2);
    expect(readZip64ExtraFieldOffset(other)).toBeNull();
  });
});

describe("buildCentralDirectoryEntry", () => {
  const baseParams = {
    nameBytes: nameBytesOf("chunk_001.wav"),
    modified: new Date(2026, 7, 12, 14, 30, 0),
    crc32: 0xdeadbeef,
    compressedSize: 123,
    uncompressedSize: 456,
  };

  it("writes CD_FIXED_SIZE + name length bytes below the ZIP64 threshold, versionNeeded=20", () => {
    const buf = buildCentralDirectoryEntry({
      ...baseParams,
      localHeaderOffset: 1000,
      zip64OffsetThreshold: MAX_UINT32,
    });
    expect(buf.length).toBe(CD_FIXED_SIZE + baseParams.nameBytes.length);
    expect(buf.readUInt32LE(0)).toBe(CENTRAL_DIR_SIGNATURE);
    expect(buf.readUInt16LE(4)).toBe(VERSION_MADE_BY);
    expect(buf.readUInt16LE(6)).toBe(VERSION_NEEDED_DEFAULT);
    expect(buf.readUInt16LE(8)).toBe(0x0800);
    expect(buf.readUInt16LE(10)).toBe(8);
    expect(buf.readUInt32LE(16)).toBe(baseParams.crc32);
    expect(buf.readUInt32LE(20)).toBe(baseParams.compressedSize);
    expect(buf.readUInt32LE(24)).toBe(baseParams.uncompressedSize);
    expect(buf.readUInt16LE(28)).toBe(baseParams.nameBytes.length);
    expect(buf.readUInt16LE(30)).toBe(0); // no extra field
    expect(buf.readUInt16LE(32)).toBe(0); // comment length
    expect(buf.readUInt16LE(34)).toBe(0); // disk number start
    expect(buf.readUInt16LE(36)).toBe(0); // internal attrs
    expect(buf.readUInt32LE(38)).toBe(0); // external attrs — MS-DOS host
    expect(buf.readUInt32LE(42)).toBe(1000);
  });

  it("saturates the offset field, adds a ZIP64 extra field, and bumps versionNeeded to 45 at/above the threshold", () => {
    const buf = buildCentralDirectoryEntry({
      ...baseParams,
      localHeaderOffset: 64,
      zip64OffsetThreshold: 64,
    });
    expect(buf.readUInt16LE(6)).toBe(VERSION_NEEDED_ZIP64);
    expect(buf.readUInt32LE(42)).toBe(MAX_UINT32);
    expect(buf.readUInt16LE(30)).toBe(12); // zip64 extra field length
    const extra = buf.subarray(
      CD_FIXED_SIZE + baseParams.nameBytes.length,
      CD_FIXED_SIZE + baseParams.nameBytes.length + 12,
    );
    expect(readZip64ExtraFieldOffset(extra)).toBe(64);
  });

  it("stays below the threshold (plain offset, versionNeeded=20) just under it", () => {
    const buf = buildCentralDirectoryEntry({
      ...baseParams,
      localHeaderOffset: 63,
      zip64OffsetThreshold: 64,
    });
    expect(buf.readUInt16LE(6)).toBe(VERSION_NEEDED_DEFAULT);
    expect(buf.readUInt32LE(42)).toBe(63);
    expect(buf.readUInt16LE(30)).toBe(0);
  });
});

describe("needsZip64Eocd", () => {
  const thresholds = { entryCount: MAX_UINT16, offset: MAX_UINT32 };

  it("is false when nothing overflows", () => {
    expect(
      needsZip64Eocd(
        { entryCount: 10, cdSize: 100, cdOffset: 200 },
        thresholds,
      ),
    ).toBe(false);
  });

  it("is true when entryCount reaches the injected threshold", () => {
    expect(
      needsZip64Eocd(
        { entryCount: 5, cdSize: 100, cdOffset: 200 },
        { entryCount: 5, offset: MAX_UINT32 },
      ),
    ).toBe(true);
  });

  it("is true when cdSize reaches the injected offset threshold", () => {
    expect(
      needsZip64Eocd(
        { entryCount: 5, cdSize: 64, cdOffset: 10 },
        { entryCount: MAX_UINT16, offset: 64 },
      ),
    ).toBe(true);
  });

  it("is true when cdOffset reaches the injected offset threshold", () => {
    expect(
      needsZip64Eocd(
        { entryCount: 5, cdSize: 10, cdOffset: 64 },
        { entryCount: MAX_UINT16, offset: 64 },
      ),
    ).toBe(true);
  });
});

describe("buildEndOfCentralDirectory", () => {
  it("writes exactly EOCD_FIXED_SIZE bytes with the real values when nothing overflows", () => {
    const buf = buildEndOfCentralDirectory({
      entryCount: 3,
      cdSize: 500,
      cdOffset: 1000,
    });
    expect(buf.length).toBe(EOCD_FIXED_SIZE);
    expect(buf.readUInt32LE(0)).toBe(EOCD_SIGNATURE);
    expect(buf.readUInt16LE(4)).toBe(0);
    expect(buf.readUInt16LE(6)).toBe(0);
    expect(buf.readUInt16LE(8)).toBe(3);
    expect(buf.readUInt16LE(10)).toBe(3);
    expect(buf.readUInt32LE(12)).toBe(500);
    expect(buf.readUInt32LE(16)).toBe(1000);
    expect(buf.readUInt16LE(20)).toBe(0);
  });

  it("saturates entryCount to MAX_UINT16 independently of the other fields", () => {
    const buf = buildEndOfCentralDirectory({
      entryCount: 70_000,
      cdSize: 500,
      cdOffset: 1000,
    });
    expect(buf.readUInt16LE(8)).toBe(MAX_UINT16);
    expect(buf.readUInt16LE(10)).toBe(MAX_UINT16);
    expect(buf.readUInt32LE(12)).toBe(500);
    expect(buf.readUInt32LE(16)).toBe(1000);
  });

  it("saturates cdSize and cdOffset to MAX_UINT32 independently, per field", () => {
    const buf = buildEndOfCentralDirectory({
      entryCount: 3,
      cdSize: MAX_UINT32 + 1000,
      cdOffset: 1000, // fits — must not be saturated just because cdSize is
    });
    expect(buf.readUInt16LE(8)).toBe(3);
    expect(buf.readUInt32LE(12)).toBe(MAX_UINT32);
    expect(buf.readUInt32LE(16)).toBe(1000);
  });
});

describe("buildZip64EndOfCentralDirectory", () => {
  it("writes exactly ZIP64_EOCD_FIXED_SIZE bytes with full-width, unsaturated values", () => {
    const buf = buildZip64EndOfCentralDirectory({
      entryCount: 70_000,
      cdSize: 9_000_000_000,
      cdOffset: 8_000_000_000,
    });
    expect(buf.length).toBe(ZIP64_EOCD_FIXED_SIZE);
    expect(buf.readUInt32LE(0)).toBe(ZIP64_EOCD_SIGNATURE);
    expect(buf.readBigUInt64LE(4)).toBe(BigInt(ZIP64_EOCD_FIXED_SIZE - 12));
    expect(buf.readUInt16LE(12)).toBe(VERSION_MADE_BY);
    expect(buf.readUInt16LE(14)).toBe(VERSION_NEEDED_ZIP64);
    expect(buf.readBigUInt64LE(24)).toBe(70_000n);
    expect(buf.readBigUInt64LE(32)).toBe(70_000n);
    expect(buf.readBigUInt64LE(40)).toBe(9_000_000_000n);
    expect(buf.readBigUInt64LE(48)).toBe(8_000_000_000n);
  });
});

describe("buildZip64EndOfCentralDirectoryLocator", () => {
  it("writes exactly ZIP64_LOCATOR_FIXED_SIZE bytes pointing at the ZIP64 EOCD offset", () => {
    const buf = buildZip64EndOfCentralDirectoryLocator(12_345_678_901);
    expect(buf.length).toBe(ZIP64_LOCATOR_FIXED_SIZE);
    expect(buf.readUInt32LE(0)).toBe(ZIP64_EOCD_LOCATOR_SIGNATURE);
    expect(buf.readUInt32LE(4)).toBe(0);
    expect(buf.readBigUInt64LE(8)).toBe(12_345_678_901n);
    expect(buf.readUInt32LE(16)).toBe(1);
  });
});
