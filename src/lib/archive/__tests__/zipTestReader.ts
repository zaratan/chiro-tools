// Test-only ZIP reader: parses the central directory and inflates every
// entry for byte-for-byte comparison against the sources. Deliberately
// independent from `verifyZipArchive.ts` — it re-derives offsets from
// scratch off the local file headers rather than trusting the CD's stated
// offsets, so it can catch bugs `verifyZipArchive` itself might share.
import { readFile } from "node:fs/promises";
import { inflateRaw } from "node:zlib";
import {
  CD_FIXED_SIZE,
  CENTRAL_DIR_SIGNATURE,
  EOCD_FIXED_SIZE,
  EOCD_SIGNATURE,
  LFH_FIXED_SIZE,
  LOCAL_FILE_HEADER_SIGNATURE,
  MAX_UINT16,
  MAX_UINT32,
  readZip64ExtraFieldOffset,
  ZIP64_EOCD_LOCATOR_SIGNATURE,
  ZIP64_EOCD_SIGNATURE,
  ZIP64_LOCATOR_FIXED_SIZE,
} from "../zipFormat.js";

const inflateRawAsync = (data: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    inflateRaw(data, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });

export type ReadZipEntry = {
  name: string;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  versionNeeded: number;
  data: Buffer;
};

export type ReadZipResult = {
  entries: ReadZipEntry[];
  entryCount: number;
  cdOffset: number;
  cdSize: number;
};

/** Reads and fully parses a ZIP produced by `createZipArchive`, inflating
 * every entry's data. Throws on any structural inconsistency — tests assert
 * on the thrown message or on the returned entries directly. */
export const readZip = async (zipPath: string): Promise<ReadZipResult> => {
  const buf = await readFile(zipPath);
  const fileSize = buf.length;

  const eocdOffset = fileSize - EOCD_FIXED_SIZE;
  if (buf.readUInt32LE(eocdOffset) !== EOCD_SIGNATURE) {
    throw new Error("EOCD signature not found at expected offset");
  }

  let entryCount = buf.readUInt16LE(eocdOffset + 10);
  let cdSize = buf.readUInt32LE(eocdOffset + 12);
  let cdOffset = buf.readUInt32LE(eocdOffset + 16);

  const isSaturated =
    entryCount === MAX_UINT16 ||
    cdSize === MAX_UINT32 ||
    cdOffset === MAX_UINT32;

  if (isSaturated) {
    const locatorOffset = eocdOffset - ZIP64_LOCATOR_FIXED_SIZE;
    if (buf.readUInt32LE(locatorOffset) !== ZIP64_EOCD_LOCATOR_SIGNATURE) {
      throw new Error("ZIP64 locator signature mismatch");
    }
    const zip64EocdOffset = Number(buf.readBigUInt64LE(locatorOffset + 8));
    if (buf.readUInt32LE(zip64EocdOffset) !== ZIP64_EOCD_SIGNATURE) {
      throw new Error("ZIP64 EOCD signature mismatch");
    }
    entryCount = Number(buf.readBigUInt64LE(zip64EocdOffset + 32));
    cdSize = Number(buf.readBigUInt64LE(zip64EocdOffset + 40));
    cdOffset = Number(buf.readBigUInt64LE(zip64EocdOffset + 48));
  }

  const entries: ReadZipEntry[] = [];
  let pos = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (buf.readUInt32LE(pos) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error(`CD signature mismatch at entry ${i.toString()}`);
    }
    const versionNeeded = buf.readUInt16LE(pos + 6);
    const crc32 = buf.readUInt32LE(pos + 16);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const uncompressedSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    let localHeaderOffset = buf.readUInt32LE(pos + 42);
    const name = buf
      .subarray(pos + CD_FIXED_SIZE, pos + CD_FIXED_SIZE + nameLen)
      .toString("utf8");

    if (localHeaderOffset === MAX_UINT32) {
      const extra = buf.subarray(
        pos + CD_FIXED_SIZE + nameLen,
        pos + CD_FIXED_SIZE + nameLen + extraLen,
      );
      const zip64Offset = readZip64ExtraFieldOffset(extra);
      if (zip64Offset === null) {
        throw new Error(`missing ZIP64 extra field for entry ${name}`);
      }
      localHeaderOffset = zip64Offset;
    }

    if (buf.readUInt32LE(localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw new Error(`LFH signature mismatch for entry ${name}`);
    }
    const lfhNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const lfhName = buf
      .subarray(
        localHeaderOffset + LFH_FIXED_SIZE,
        localHeaderOffset + LFH_FIXED_SIZE + lfhNameLen,
      )
      .toString("utf8");
    if (lfhName !== name) {
      throw new Error(`LFH name "${lfhName}" != CD name "${name}"`);
    }

    const dataStart = localHeaderOffset + LFH_FIXED_SIZE + lfhNameLen;
    const compData = buf.subarray(dataStart, dataStart + compressedSize);
    const data =
      compressedSize === 0 ? Buffer.alloc(0) : await inflateRawAsync(compData);
    if (data.length !== uncompressedSize) {
      throw new Error(
        `inflated size mismatch for entry ${name}: got ${data.length.toString()}, expected ${uncompressedSize.toString()}`,
      );
    }

    entries.push({
      name,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      versionNeeded,
      data,
    });

    pos += CD_FIXED_SIZE + nameLen + extraLen + commentLen;
  }

  return { entries, entryCount, cdOffset, cdSize };
};
