import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

export const POC_ROOT = "/tmp/chiro-poc";
export const SOURCES_DIR = `${POC_ROOT}/sources`;
export const WAVEFILE_DIR = `${POC_ROOT}/wavefile`;
export const FFMPEG_DIR = `${POC_ROOT}/ffmpeg`;
export const SOX_DIR = `${POC_ROOT}/sox`;
export const CHUNK_SECONDS = 5;

export type SourceSpec = {
  key: string;
  filename: string;
  bitDepth: "16" | "24";
  channels: number;
  sampleRate: number;
  durationSeconds: number;
  mode: "preserve" | "expand-10x";
  copyFrom?: string;
  description: string;
};

const AUDIOMOTH_DIR =
  "/Users/zaratan/Projects/chiro-tools/test-data/Audiomoth/Audiomoth full";

export const SOURCES: SourceSpec[] = [
  {
    key: "audiomoth-1",
    filename: "audiomoth-210501.wav",
    bitDepth: "16",
    channels: 1,
    sampleRate: 250000,
    durationSeconds: 0,
    mode: "expand-10x",
    copyFrom: `${AUDIOMOTH_DIR}/Car340581-2026-Pass2-Z5-20260507_210501T.WAV`,
    description: "AudioMoth real 250 kHz 16-bit mono w/ LIST/INFO/ICMT metadata",
  },
  {
    key: "audiomoth-2",
    filename: "audiomoth-212001.wav",
    bitDepth: "16",
    channels: 1,
    sampleRate: 250000,
    durationSeconds: 0,
    mode: "expand-10x",
    copyFrom: `${AUDIOMOTH_DIR}/Car340581-2026-Pass2-Z5-20260507_212001T.WAV`,
    description: "AudioMoth real (2)",
  },
  {
    key: "audiomoth-3",
    filename: "audiomoth-042501.wav",
    bitDepth: "16",
    channels: 1,
    sampleRate: 250000,
    durationSeconds: 0,
    mode: "expand-10x",
    copyFrom: `${AUDIOMOTH_DIR}/Car340581-2026-Pass2-Z5-20260508_042501T.WAV`,
    description: "AudioMoth real (3)",
  },
  {
    key: "synth-teensy-mono",
    filename: "synth-teensy-mono.wav",
    bitDepth: "16",
    channels: 1,
    sampleRate: 38400,
    durationSeconds: 11,
    mode: "preserve",
    description: "Synthetic 16-bit mono 38.4 kHz, 11s (2 full + tail)",
  },
  {
    key: "synth-stereo-24",
    filename: "synth-stereo-24.wav",
    bitDepth: "24",
    channels: 2,
    sampleRate: 48000,
    durationSeconds: 6,
    mode: "preserve",
    description: "Synthetic 24-bit stereo 48 kHz, 6s (1 full + tail)",
  },
  {
    key: "synth-exact-multiple",
    filename: "synth-exact-multiple.wav",
    bitDepth: "16",
    channels: 1,
    sampleRate: 48000,
    durationSeconds: 15,
    mode: "preserve",
    description: "Synthetic 16-bit mono 48 kHz, 15s exact (no tail)",
  },
];

export type ChunkManifestEntry = {
  source: string;
  chunk: string;
  sha256: string;
  bytes: number;
};

export type Manifest = {
  pipeline: string;
  wallMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  splitMs: number;
  rewriteMs: number;
  ioMs: number;
  entries: ChunkManifestEntry[];
};

export const sha256OfBuffer = (buf: Buffer | Uint8Array): string =>
  createHash("sha256").update(buf).digest("hex");

export const sha256OfFile = (filePath: string): string =>
  sha256OfBuffer(readFileSync(filePath));

/**
 * Rewrites the WAV header to a canonical 44-byte PCM standard layout:
 * RIFF / WAVE / fmt (16 bytes, audioFormat=1) / data. Strips any LIST/INFO/
 * JUNK/fact chunks that ffmpeg or sox may have inserted. The `data` zone is
 * preserved byte-for-byte. If `expand10x` is true, the sample rate written
 * is `round(srcRate / 10)`, matching `splitWavFile`'s expand-10x semantics.
 *
 * Pre-condition: input has a parseable RIFF/fmt /data structure with PCM
 * samples (audioFormat = 1 or 0xfffe with PCM subformat).
 */
export const rewriteHeaderToStandardPcm = (
  filePath: string,
  expand10x: boolean,
): void => {
  const src = readFileSync(filePath);
  if (src.subarray(0, 4).toString("ascii") !== "RIFF") {
    throw new Error(`${filePath}: not a RIFF file`);
  }
  if (src.subarray(8, 12).toString("ascii") !== "WAVE") {
    throw new Error(`${filePath}: not a WAVE file`);
  }

  let pos = 12;
  let channels = 0;
  let srcRate = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataSize = 0;

  while (pos + 8 <= src.byteLength) {
    const id = src.subarray(pos, pos + 4).toString("ascii");
    const size = src.readUInt32LE(pos + 4);
    if (id === "fmt ") {
      channels = src.readUInt16LE(pos + 10);
      srcRate = src.readUInt32LE(pos + 12);
      bitsPerSample = src.readUInt16LE(pos + 22);
    } else if (id === "data") {
      dataOffset = pos + 8;
      dataSize = size;
      break;
    }
    pos += 8 + size + (size % 2);
  }

  if (dataOffset < 0 || channels === 0 || srcRate === 0 || bitsPerSample === 0) {
    throw new Error(`${filePath}: failed to parse fmt/data chunks`);
  }

  const outRate = expand10x ? Math.round(srcRate / 10) : srcRate;
  const bytesPerSample = bitsPerSample / 8;
  const byteRate = outRate * channels * bytesPerSample;
  const blockAlign = channels * bytesPerSample;

  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(outRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  const out = Buffer.concat([
    header,
    src.subarray(dataOffset, dataOffset + dataSize),
  ]);
  writeFileSync(filePath, out);
};
