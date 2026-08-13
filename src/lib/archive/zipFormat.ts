/**
 * Pure binary builders for the ZIP local-file-header / central-directory /
 * end-of-central-directory records this project writes. No I/O here —
 * `createZipArchive.ts` sequences these buffers onto disk, `verifyZipArchive.ts`
 * parses them back.
 *
 * Field layout follows the PKWARE APPNOTE.TXT ZIP spec (deflate, ZIP64
 * extension). Only what this project actually emits is implemented — no
 * data descriptors, no per-entry comments, no multi-disk archives.
 */

export const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
export const CENTRAL_DIR_SIGNATURE = 0x02014b50;
export const EOCD_SIGNATURE = 0x06054b50;
export const ZIP64_EOCD_SIGNATURE = 0x06064b50;
export const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;

const ZIP64_EXTRA_TAG = 0x0001;
const UTF8_FLAG = 0x0800;
const DEFLATE_METHOD = 8;

/** Version 2.0, high byte 0 = MS-DOS host. Never Unix (high byte 3) with
 * externalFileAttributes left at 0 — Info-ZIP would then extract as mode 000. */
export const VERSION_MADE_BY = 0x0014;
export const VERSION_NEEDED_DEFAULT = 20;
export const VERSION_NEEDED_ZIP64 = 45;

export const LFH_FIXED_SIZE = 30;
export const CD_FIXED_SIZE = 46;
export const EOCD_FIXED_SIZE = 22;
export const ZIP64_EOCD_FIXED_SIZE = 56;
export const ZIP64_LOCATOR_FIXED_SIZE = 20;

/** Offset within a local file header where the 12-byte CRC-32 / compressed
 * size / uncompressed size patch is written after streaming an entry. */
export const CRC_FIELD_OFFSET = 14;

export const MAX_UINT16 = 0xffff;
export const MAX_UINT32 = 0xffffffff;

/** `Buffer.from(name, "utf8")` is the single source of truth for a name's
 * on-disk length — `String.length` on an accented name undercounts and
 * corrupts every downstream offset. */
export const nameBytesOf = (name: string): Buffer => Buffer.from(name, "utf8");

export type DosDateTime = { dosTime: number; dosDate: number };

const DOS_EPOCH_YEAR = 1980;
const DOS_MAX_YEAR = 2107;
const DOS_MIN_DATE = new Date(DOS_EPOCH_YEAR, 0, 1, 0, 0, 0);
const DOS_MAX_DATE = new Date(DOS_MAX_YEAR, 11, 31, 23, 59, 58);

/**
 * Converts a JS `Date` to DOS date/time fields, clamped to the representable
 * range `[1980-01-01, 2107-12-31]` — the 7-bit DOS year field overflows past
 * 2107 (`year - 1980 > 127`), and `writeUInt16LE` throws `ERR_OUT_OF_RANGE`
 * on a value that doesn't fit, which would violate the no-throw contract.
 * `Number.isNaN(date.getTime())` (e.g. `new Date(NaN)`) falls back to the
 * epoch rather than propagating garbage into the header.
 */
export const toDosDateTime = (date: Date): DosDateTime => {
  let safeDate = date;
  if (Number.isNaN(date.getTime())) {
    safeDate = DOS_MIN_DATE;
  } else if (date.getTime() < DOS_MIN_DATE.getTime()) {
    safeDate = DOS_MIN_DATE;
  } else if (date.getTime() > DOS_MAX_DATE.getTime()) {
    safeDate = DOS_MAX_DATE;
  }

  const dosDate =
    ((safeDate.getFullYear() - DOS_EPOCH_YEAR) << 9) |
    ((safeDate.getMonth() + 1) << 5) |
    safeDate.getDate();
  const dosTime =
    (safeDate.getHours() << 11) |
    (safeDate.getMinutes() << 5) |
    Math.floor(safeDate.getSeconds() / 2);

  return { dosTime, dosDate };
};

export type LocalFileHeaderParams = {
  nameBytes: Buffer;
  modified: Date;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
};

/**
 * Builds a local file header with CRC-32 and sizes left at 0 — this project
 * never emits a data descriptor (bit 3 of the flag field is never set), so
 * these three fields are patched in place after the entry's bytes are
 * streamed (see `buildLocalFileHeaderPatch` + `CRC_FIELD_OFFSET`). Local
 * headers never carry a ZIP64 extra field — `versionNeeded` is always 20.
 */
export const buildLocalFileHeader = (params: LocalFileHeaderParams): Buffer => {
  const { dosTime, dosDate } = toDosDateTime(params.modified);
  const buf = Buffer.alloc(LFH_FIXED_SIZE + params.nameBytes.length);

  buf.writeUInt32LE(LOCAL_FILE_HEADER_SIGNATURE, 0);
  buf.writeUInt16LE(VERSION_NEEDED_DEFAULT, 4);
  buf.writeUInt16LE(UTF8_FLAG, 6);
  buf.writeUInt16LE(DEFLATE_METHOD, 8);
  buf.writeUInt16LE(dosTime, 10);
  buf.writeUInt16LE(dosDate, 12);
  buf.writeUInt32LE(params.crc32, 14);
  buf.writeUInt32LE(params.compressedSize, 18);
  buf.writeUInt32LE(params.uncompressedSize, 22);
  buf.writeUInt16LE(params.nameBytes.length, 26);
  buf.writeUInt16LE(0, 28);
  params.nameBytes.copy(buf, LFH_FIXED_SIZE);

  return buf;
};

/**
 * The 12 contiguous bytes (CRC-32, compressed size, uncompressed size) that
 * get pwrite'd at `localHeaderOffset + CRC_FIELD_OFFSET` once an entry has
 * finished streaming. Also used by `verifyZipArchive` to check the patch
 * landed correctly by comparing it against the same bytes read back.
 */
export const buildLocalFileHeaderPatch = (
  crc32: number,
  compressedSize: number,
  uncompressedSize: number,
): Buffer => {
  const buf = Buffer.alloc(12);
  buf.writeUInt32LE(crc32, 0);
  buf.writeUInt32LE(compressedSize, 4);
  buf.writeUInt32LE(uncompressedSize, 8);
  return buf;
};

/** ZIP64 extra field carrying only the local-header offset (tag 0x0001,
 * 8-byte payload) — this project never lets per-entry sizes overflow 32
 * bits (admission rejects any source ≥ 4 GiB as `entry-too-large`), so the
 * offset is always the first and only field present. */
export const buildZip64ExtraField = (localHeaderOffset: number): Buffer => {
  const buf = Buffer.alloc(4 + 8);
  buf.writeUInt16LE(ZIP64_EXTRA_TAG, 0);
  buf.writeUInt16LE(8, 2);
  buf.writeBigUInt64LE(BigInt(localHeaderOffset), 4);
  return buf;
};

export const readZip64ExtraFieldOffset = (extra: Buffer): number | null => {
  let pos = 0;
  while (pos + 4 <= extra.length) {
    const tag = extra.readUInt16LE(pos);
    const size = extra.readUInt16LE(pos + 2);
    if (tag === ZIP64_EXTRA_TAG && size >= 8 && pos + 4 + 8 <= extra.length) {
      return Number(extra.readBigUInt64LE(pos + 4));
    }
    pos += 4 + size;
  }
  return null;
};

export type CentralDirectoryEntryParams = {
  nameBytes: Buffer;
  modified: Date;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  /** Threshold above which `localHeaderOffset` is stored via a ZIP64 extra
   * field instead of the plain 32-bit offset field — injectable so tests can
   * exercise the ZIP64 path without a multi-GB fixture. */
  zip64OffsetThreshold: number;
};

/**
 * Builds a central directory entry. When `localHeaderOffset` reaches
 * `zip64OffsetThreshold`, the offset field is saturated to 0xFFFFFFFF, the
 * real offset moves into a ZIP64 extra field, and `versionNeeded` becomes 45
 * — for this entry only; every other entry and every local header stays at
 * version 20.
 */
export const buildCentralDirectoryEntry = (
  params: CentralDirectoryEntryParams,
): Buffer => {
  const needsZip64Offset =
    params.localHeaderOffset >= params.zip64OffsetThreshold;
  const { dosTime, dosDate } = toDosDateTime(params.modified);
  const extra = needsZip64Offset
    ? buildZip64ExtraField(params.localHeaderOffset)
    : Buffer.alloc(0);
  const versionNeeded = needsZip64Offset
    ? VERSION_NEEDED_ZIP64
    : VERSION_NEEDED_DEFAULT;
  const offsetField = needsZip64Offset ? MAX_UINT32 : params.localHeaderOffset;

  const buf = Buffer.alloc(
    CD_FIXED_SIZE + params.nameBytes.length + extra.length,
  );

  buf.writeUInt32LE(CENTRAL_DIR_SIGNATURE, 0);
  buf.writeUInt16LE(VERSION_MADE_BY, 4);
  buf.writeUInt16LE(versionNeeded, 6);
  buf.writeUInt16LE(UTF8_FLAG, 8);
  buf.writeUInt16LE(DEFLATE_METHOD, 10);
  buf.writeUInt16LE(dosTime, 12);
  buf.writeUInt16LE(dosDate, 14);
  buf.writeUInt32LE(params.crc32, 16);
  buf.writeUInt32LE(params.compressedSize, 20);
  buf.writeUInt32LE(params.uncompressedSize, 24);
  buf.writeUInt16LE(params.nameBytes.length, 28);
  buf.writeUInt16LE(extra.length, 30);
  buf.writeUInt16LE(0, 32); // file comment length
  buf.writeUInt16LE(0, 34); // disk number start
  buf.writeUInt16LE(0, 36); // internal file attributes
  buf.writeUInt32LE(0, 38); // external file attributes — MS-DOS host, never Unix mode 0
  buf.writeUInt32LE(offsetField, 42);
  params.nameBytes.copy(buf, CD_FIXED_SIZE);
  extra.copy(buf, CD_FIXED_SIZE + params.nameBytes.length);

  return buf;
};

export type EndOfCentralDirectoryParams = {
  entryCount: number;
  cdSize: number;
  cdOffset: number;
};

/**
 * Whether the archive needs a ZIP64 EOCD record + locator ahead of the
 * classic EOCD — triggered when the entry count or the central directory's
 * size/offset overflow the classic record's 16/32-bit fields. Thresholds are
 * injectable (defaults are the real ZIP limits) so tests can exercise this
 * path without multi-GB or 65k-entry fixtures.
 */
export const needsZip64Eocd = (
  params: EndOfCentralDirectoryParams,
  thresholds: { entryCount: number; offset: number },
): boolean =>
  params.entryCount >= thresholds.entryCount ||
  params.cdSize >= thresholds.offset ||
  params.cdOffset >= thresholds.offset;

/**
 * Classic End Of Central Directory record — always written, even when a
 * ZIP64 EOCD precedes it. Each field is saturated independently
 * (`Math.min(v, MAX)`) rather than the whole record being swapped for a
 * placeholder: a non-ZIP64-aware reader can still read whatever fields do
 * fit (e.g. entry count under 0xFFFF with a saturated offset).
 */
export const buildEndOfCentralDirectory = (
  params: EndOfCentralDirectoryParams,
): Buffer => {
  const buf = Buffer.alloc(EOCD_FIXED_SIZE);
  const cappedCount = Math.min(params.entryCount, MAX_UINT16);

  buf.writeUInt32LE(EOCD_SIGNATURE, 0);
  buf.writeUInt16LE(0, 4); // number of this disk
  buf.writeUInt16LE(0, 6); // disk where CD starts
  buf.writeUInt16LE(cappedCount, 8);
  buf.writeUInt16LE(cappedCount, 10);
  buf.writeUInt32LE(Math.min(params.cdSize, MAX_UINT32), 12);
  buf.writeUInt32LE(Math.min(params.cdOffset, MAX_UINT32), 16);
  buf.writeUInt16LE(0, 20); // comment length — always empty

  return buf;
};

/** ZIP64 EOCD record: full-width entry count / CD size / CD offset, no
 * saturation — this is what a ZIP64-aware reader consults once the locator
 * points it here. */
export const buildZip64EndOfCentralDirectory = (
  params: EndOfCentralDirectoryParams,
): Buffer => {
  const buf = Buffer.alloc(ZIP64_EOCD_FIXED_SIZE);

  buf.writeUInt32LE(ZIP64_EOCD_SIGNATURE, 0);
  buf.writeBigUInt64LE(BigInt(ZIP64_EOCD_FIXED_SIZE - 12), 4);
  buf.writeUInt16LE(VERSION_MADE_BY, 12);
  buf.writeUInt16LE(VERSION_NEEDED_ZIP64, 14);
  buf.writeUInt32LE(0, 16); // number of this disk
  buf.writeUInt32LE(0, 20); // disk where CD starts
  buf.writeBigUInt64LE(BigInt(params.entryCount), 24);
  buf.writeBigUInt64LE(BigInt(params.entryCount), 32);
  buf.writeBigUInt64LE(BigInt(params.cdSize), 40);
  buf.writeBigUInt64LE(BigInt(params.cdOffset), 48);

  return buf;
};

/** Points a ZIP64-aware reader from the classic EOCD back to the ZIP64 EOCD
 * record that precedes it. */
export const buildZip64EndOfCentralDirectoryLocator = (
  zip64EocdOffset: number,
): Buffer => {
  const buf = Buffer.alloc(ZIP64_LOCATOR_FIXED_SIZE);

  buf.writeUInt32LE(ZIP64_EOCD_LOCATOR_SIGNATURE, 0);
  buf.writeUInt32LE(0, 4); // disk with the ZIP64 EOCD record
  buf.writeBigUInt64LE(BigInt(zip64EocdOffset), 8);
  buf.writeUInt32LE(1, 16); // total number of disks

  return buf;
};
