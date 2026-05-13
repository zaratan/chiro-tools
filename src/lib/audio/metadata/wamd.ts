/**
 * Wildlife Acoustics `wamd` chunk serialiser.
 * Reverse-engineered from Kaleidoscope output and cross-checked against
 * https://github.com/riggsd/guano-py/blob/master/bin/wamd2guano.py
 *
 * Output layout:
 *   "wamd" (4 B)
 *   chunkSize (uint32 LE) — excludes the 8-byte ID+size header
 *   records, each: tag (uint16 LE) + length (uint32 LE) + value (length B)
 *   1 byte 0x00 padding if (8 + chunkSize) is odd, for RIFF 2-byte alignment
 *
 * No header bytes precede the records.
 */

export type WamdMeta = {
  /** Source timestamp; the record is omitted when null. */
  timestamp: Date | null;
  /** Time-expansion factor encoded in the output (10 for Vigie-Chiro). */
  timeExpansion: number;
  /** Identifier such as `chiro <version>`. */
  software: string;
};

const WAMD_CHUNK_ID = "wamd";

const WAMD_TAG_WA_VERSION = 0x0000;
const WAMD_TAG_TIMESTAMP = 0x0005;
const WAMD_TAG_SOFTWARE = 0x0008;
const WAMD_TAG_TIME_EXPANSION = 0x000f;

const WA_VERSION = 1;

const padTwo = (n: number): string => String(n).padStart(2, "0");

const formatTimezoneOffset = (date: Date): string => {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return `${sign}${padTwo(Math.floor(abs / 60))}:${padTwo(abs % 60)}`;
};

const formatWamdTimestamp = (date: Date): string => {
  const datePart = `${String(date.getFullYear())}-${padTwo(date.getMonth() + 1)}-${padTwo(date.getDate())}`;
  const timePart = `${padTwo(date.getHours())}:${padTwo(date.getMinutes())}:${padTwo(date.getSeconds())}`;
  return `${datePart} ${timePart}${formatTimezoneOffset(date)}`;
};

type WamdRecord = {
  tag: number;
  value: Buffer;
};

const recordUint16 = (tag: number, value: number): WamdRecord => {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value, 0);
  return { tag, value: buf };
};

const recordString = (tag: number, value: string): WamdRecord => ({
  tag,
  value: Buffer.from(value, "utf8"),
});

const buildRecords = (meta: WamdMeta): WamdRecord[] => {
  const records: WamdRecord[] = [
    recordUint16(WAMD_TAG_WA_VERSION, WA_VERSION),
    recordUint16(WAMD_TAG_TIME_EXPANSION, meta.timeExpansion),
  ];
  if (meta.timestamp !== null) {
    records.push(
      recordString(WAMD_TAG_TIMESTAMP, formatWamdTimestamp(meta.timestamp)),
    );
  }
  records.push(recordString(WAMD_TAG_SOFTWARE, meta.software));
  return records;
};

const recordSize = (r: WamdRecord): number => 6 + r.value.byteLength;

export const buildWamdChunk = (meta: WamdMeta): Buffer => {
  const records = buildRecords(meta);
  const contentSize = records.reduce((acc, r) => acc + recordSize(r), 0);
  const totalSize = 8 + contentSize;
  const padded = totalSize % 2 === 1;
  const chunk = Buffer.alloc(totalSize + (padded ? 1 : 0));

  chunk.write(WAMD_CHUNK_ID, 0, "ascii");
  chunk.writeUInt32LE(contentSize, 4);

  let offset = 8;
  for (const r of records) {
    chunk.writeUInt16LE(r.tag, offset);
    chunk.writeUInt32LE(r.value.byteLength, offset + 2);
    r.value.copy(chunk, offset + 6);
    offset += recordSize(r);
  }

  return chunk;
};
