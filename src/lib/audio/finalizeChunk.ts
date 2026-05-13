import { open, stat } from "node:fs/promises";
import { rewriteHeaderToStandardPcm } from "./wavHeader.js";

export type FinalizeOptions = {
  expand10x: boolean;
  /** Optional ancillary RIFF chunks (e.g. `wamd`, `guan`) appended after `data`. */
  ancillaries?: Buffer[];
};

const RIFF_SIZE_OFFSET = 4;
const RIFF_HEADER_BYTES = 8;

/**
 * Finalises a chunk file by writing a canonical PCM header and, optionally,
 * appending RIFF ancillary chunks (wamd, GUANO) after the `data` chunk.
 *
 * Pre-condition: `filePath` exists, contains a parseable RIFF/fmt/data WAV.
 * Post-condition: 44-byte canonical header + dataSize samples + 1 byte 0x00
 * padding if dataSize is odd + concatenated ancillaries. The RIFF size field
 * is updated to cover the appended bytes (excluding the 8-byte RIFF header
 * itself).
 *
 * Ancillaries are caller-padded — each must already be 2-byte aligned.
 */
export const finalizeChunk = async (
  filePath: string,
  opts: FinalizeOptions,
): Promise<void> => {
  await rewriteHeaderToStandardPcm(filePath, opts.expand10x);

  const ancillaries = opts.ancillaries ?? [];
  if (ancillaries.length === 0) return;

  await appendAncillaryChunks(filePath, ancillaries);
};

export const appendAncillaryChunks = async (
  filePath: string,
  chunks: Buffer[],
): Promise<void> => {
  if (chunks.length === 0) return;

  const stats = await stat(filePath);
  const currentSize = stats.size;
  const dataSize = currentSize - 44;
  const dataNeedsPadding = dataSize % 2 === 1;
  const padByte = dataNeedsPadding ? 1 : 0;

  const ancillaryBytes = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const newRiffSize =
    currentSize - RIFF_HEADER_BYTES + padByte + ancillaryBytes;

  const fh = await open(filePath, "r+");
  try {
    const riffSizeBuf = Buffer.alloc(4);
    riffSizeBuf.writeUInt32LE(newRiffSize, 0);
    await fh.write(riffSizeBuf, 0, 4, RIFF_SIZE_OFFSET);

    let writeOffset = currentSize;
    if (dataNeedsPadding) {
      await fh.write(Buffer.from([0x00]), 0, 1, writeOffset);
      writeOffset += 1;
    }
    for (const chunk of chunks) {
      await fh.write(chunk, 0, chunk.byteLength, writeOffset);
      writeOffset += chunk.byteLength;
    }
  } finally {
    await fh.close();
  }
};
