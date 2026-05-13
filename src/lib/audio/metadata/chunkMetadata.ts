import { CHUNK_REAL_SECONDS } from "../constants.js";
import type { GuanoMeta } from "./guano.js";
import type { WamdMeta } from "./wamd.js";

export type ChunkMetaInput = {
  /** Recording start time parsed from the source filename, or null when unknown. */
  sourceTimestamp: Date | null;
  /** Zero-based chunk index within the source file. */
  chunkIndex: number;
  /** Number of audio samples in this chunk (post-split). */
  chunkSamples: number;
  /** Output sample rate written in the chunk's WAV header. */
  outputSampleRate: number;
  /** Time-expansion factor encoded in the output (10 for Vigie-Chiro). */
  timeExpansion: number;
  /** Source filename after chiro renaming, without the `_NNN.wav` chunk suffix. */
  originalFilename: string;
  /** chiro version string for `WA|chiro|Version` and wamd Software fields. */
  chiroVersion: string;
};

const computeLengthSeconds = (input: ChunkMetaInput): number =>
  input.chunkSamples / input.outputSampleRate / input.timeExpansion;

const computeChunkTimestamp = (input: ChunkMetaInput): Date | null => {
  if (input.sourceTimestamp === null) return null;
  const offsetMs = input.chunkIndex * CHUNK_REAL_SECONDS * 1000;
  return new Date(input.sourceTimestamp.getTime() + offsetMs);
};

export const buildChunkMeta = (
  input: ChunkMetaInput,
): { guano: GuanoMeta; wamd: WamdMeta } => {
  const timestamp = computeChunkTimestamp(input);
  const guano: GuanoMeta = {
    lengthSeconds: computeLengthSeconds(input),
    originalFilename: input.originalFilename,
    realSampleRate: input.outputSampleRate * input.timeExpansion,
    timeExpansion: input.timeExpansion,
    timestamp,
    chiroVersion: input.chiroVersion,
  };
  const wamd: WamdMeta = {
    timestamp,
    timeExpansion: input.timeExpansion,
    software: `chiro ${input.chiroVersion}`,
  };
  return { guano, wamd };
};
