/**
 * GUANO (Grand Unified Acoustic Notation Ontology) chunk serialiser.
 * Spec: https://github.com/riggsd/guano-spec
 *
 * Output layout:
 *   "guan" (4 B)
 *   chunkSize (uint32 LE) — excludes the 8-byte ID+size header
 *   UTF-8 content — lines of `key:value\n`
 *   1 byte 0x00 padding if (8 + chunkSize) is odd, for RIFF 2-byte alignment
 */

export type GuanoMeta = {
  /** Real-time duration of this chunk in seconds (5.0 except for the tail). */
  lengthSeconds: number;
  /** Source filename after chiro renaming, without the `_NNN.wav` chunk suffix. */
  originalFilename: string;
  /** Real (ultrasonic) sample rate, i.e. outputSampleRate × timeExpansion. */
  realSampleRate: number;
  /** Time-expansion factor encoded in the output (10 for Vigie-Chiro). */
  timeExpansion: number;
  /** Source timestamp; the line is omitted when null rather than written as `Invalid Date`. */
  timestamp: Date | null;
  /** chiro version string included for traceability via `WA|chiro|Version:...`. */
  chiroVersion: string;
};

const GUANO_CHUNK_ID = "guan";

const formatLength = (seconds: number): string => seconds.toFixed(6);

const padTwo = (n: number): string => String(n).padStart(2, "0");

const formatTimezoneOffset = (date: Date): string => {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return `${sign}${padTwo(Math.floor(abs / 60))}:${padTwo(abs % 60)}`;
};

const formatGuanoTimestamp = (date: Date): string => {
  const datePart = `${String(date.getFullYear())}-${padTwo(date.getMonth() + 1)}-${padTwo(date.getDate())}`;
  const timePart = `${padTwo(date.getHours())}:${padTwo(date.getMinutes())}:${padTwo(date.getSeconds())}`;
  return `${datePart} ${timePart}${formatTimezoneOffset(date)}`;
};

const buildContent = (meta: GuanoMeta): string => {
  const lines: string[] = [
    "GUANO|Version:1.0",
    `Length:${formatLength(meta.lengthSeconds)}`,
    `Original Filename:${meta.originalFilename}`,
    `Samplerate:${String(meta.realSampleRate)}`,
    `TE:${String(meta.timeExpansion)}`,
  ];
  if (meta.timestamp !== null) {
    lines.push(`Timestamp:${formatGuanoTimestamp(meta.timestamp)}`);
  }
  lines.push(`WA|chiro|Version:${meta.chiroVersion}`);
  return lines.join("\n") + "\n";
};

export const buildGuanoChunk = (meta: GuanoMeta): Buffer => {
  const content = Buffer.from(buildContent(meta), "utf8");
  const totalSize = 8 + content.byteLength;
  const padded = totalSize % 2 === 1;
  const chunk = Buffer.alloc(totalSize + (padded ? 1 : 0));
  chunk.write(GUANO_CHUNK_ID, 0, "ascii");
  chunk.writeUInt32LE(content.byteLength, 4);
  content.copy(chunk, 8);
  return chunk;
};
