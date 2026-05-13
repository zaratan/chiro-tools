import { open } from "node:fs/promises";

const RIFF_MAGIC = "RIFF";
const WAVE_MAGIC = "WAVE";
const FMT_CHUNK_ID = "fmt ";
const DATA_CHUNK_ID = "data";
const CANONICAL_HEADER_BYTES = 44;
const FMT_CHUNK_SIZE = 16;
const PCM_AUDIO_FORMAT = 1;

type ParsedWavChunks = {
  channels: number;
  srcRate: number;
  bitsPerSample: number;
  dataOffset: number;
  dataSize: number;
};

const parseChunks = (src: Buffer): ParsedWavChunks | null => {
  if (src.subarray(0, 4).toString("ascii") !== RIFF_MAGIC) return null;
  if (src.subarray(8, 12).toString("ascii") !== WAVE_MAGIC) return null;

  let pos = 12;
  let channels = 0;
  let srcRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataSize = 0;

  while (pos + 8 <= src.byteLength) {
    const id = src.subarray(pos, pos + 4).toString("ascii");
    const size = src.readUInt32LE(pos + 4);

    if (id === FMT_CHUNK_ID) {
      channels = src.readUInt16LE(pos + 10);
      srcRate = src.readUInt32LE(pos + 12);
      bitsPerSample = src.readUInt16LE(pos + 22);
    } else if (id === DATA_CHUNK_ID) {
      dataOffset = pos + 8;
      dataSize = size;
      break;
    }

    pos += 8 + size + (size % 2);
  }

  if (
    dataOffset < 0 ||
    channels === 0 ||
    srcRate === 0 ||
    bitsPerSample === 0
  ) {
    return null;
  }

  return { channels, srcRate, bitsPerSample, dataOffset, dataSize };
};

const buildCanonicalHeader = (
  channels: number,
  outRate: number,
  bitsPerSample: number,
  dataSize: number,
): Buffer => {
  const bytesPerSample = bitsPerSample / 8;
  const byteRate = outRate * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;

  const header = Buffer.alloc(CANONICAL_HEADER_BYTES);
  header.write(RIFF_MAGIC, 0);
  header.writeUInt32LE(FMT_CHUNK_SIZE + 20 + dataSize, 4);
  header.write(WAVE_MAGIC, 8);
  header.write(FMT_CHUNK_ID, 12);
  header.writeUInt32LE(FMT_CHUNK_SIZE, 16);
  header.writeUInt16LE(PCM_AUDIO_FORMAT, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(outRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write(DATA_CHUNK_ID, 36);
  header.writeUInt32LE(dataSize, 40);

  return header;
};

/**
 * Rewrites the WAV header of `filePath` to a 44-byte canonical PCM layout:
 * RIFF / WAVE / fmt (16 bytes, audioFormat=1) / data. Strips any LIST/INFO/
 * JUNK/fact chunks between fmt and data. The data zone is preserved
 * byte-for-byte. Writes sequentially (header then data slice) to avoid
 * allocating a concat buffer.
 *
 * Pre-condition: the file has a parseable RIFF/fmt/data structure with PCM
 * samples (audioFormat=1 or 0xfffe with PCM subformat).
 */
export const rewriteHeaderToStandardPcm = async (
  filePath: string,
  expand10x: boolean,
): Promise<void> => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(filePath);

  const parsed = parseChunks(src);
  if (parsed === null) {
    throw new Error(`${filePath}: failed to parse RIFF/fmt/data chunks`);
  }

  const { channels, srcRate, bitsPerSample, dataOffset, dataSize } = parsed;
  const outRate = expand10x ? Math.round(srcRate / 10) : srcRate;

  const header = buildCanonicalHeader(
    channels,
    outRate,
    bitsPerSample,
    dataSize,
  );
  const dataSlice = src.subarray(dataOffset, dataOffset + dataSize);

  const fh = await open(filePath, "w");
  try {
    await fh.write(header);
    await fh.write(dataSlice);
  } finally {
    await fh.close();
  }
};
