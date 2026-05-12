import { WaveFile } from "wavefile";
import type { TimeExpansionMode } from "../../types.js";

export type SplitWavOptions = {
  mode: TimeExpansionMode;
  chunkSeconds: number;
  signal?: AbortSignal;
};

export type EncodedChunk = {
  index: number;
  buffer: Uint8Array;
  samplesInChunk: number;
  outputSampleRate: number;
  channels: number;
};

export type SplitErrorCode =
  | "invalid-header"
  | "unsupported-format"
  | "unsupported-bit-depth"
  | "no-samples";

export type SplitWavYield =
  | { kind: "chunk"; chunk: EncodedChunk }
  | { kind: "abort" }
  | { kind: "error"; code: SplitErrorCode };

type WavFmt = {
  audioFormat: number;
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
  cbSize: number;
  subformat: number[];
};

const PCM_AUDIO_FORMAT = 1;
const EXTENSIBLE_AUDIO_FORMAT = 0xfffe;

// First 16 bytes of the WAVE_FORMAT_EXTENSIBLE subformat GUID for plain PCM.
// Anything else (float, A-law, mu-law) is rejected — Vigie-Chiro's analysis
// chain requires integer PCM samples.
const PCM_SUBFORMAT_PREFIX = [0x01, 0x00];

type BitDepthMapping = {
  bitDepth: "16" | "24";
  Ctor: typeof Int16Array | typeof Int32Array;
};

const mapBitDepth = (wavBitDepth: string): BitDepthMapping | null => {
  if (wavBitDepth === "16") return { bitDepth: "16", Ctor: Int16Array };
  if (wavBitDepth === "24") return { bitDepth: "24", Ctor: Int32Array };
  return null;
};

const isPcmSubformat = (subformat: number[]): boolean => {
  if (subformat.length < PCM_SUBFORMAT_PREFIX.length) return false;
  for (let i = 0; i < PCM_SUBFORMAT_PREFIX.length; i++) {
    if (subformat[i] !== PCM_SUBFORMAT_PREFIX[i]) return false;
  }
  return true;
};

const isAllowedFormat = (fmt: WavFmt): boolean => {
  if (fmt.audioFormat === PCM_AUDIO_FORMAT) return true;
  if (fmt.audioFormat === EXTENSIBLE_AUDIO_FORMAT) {
    return isPcmSubformat(fmt.subformat);
  }
  return false;
};

const normalizeChannels = (
  raw: Int16Array | Int32Array | (Int16Array | Int32Array)[],
): (Int16Array | Int32Array)[] => (Array.isArray(raw) ? raw : [raw]);

/**
 * Splits a WAV buffer into chunks of `chunkSeconds` (measured on the OUTPUT
 * timeline). Multichannel files keep all channels grouped per chunk.
 *
 * Mode `"preserve"` keeps the source sample rate.
 * Mode `"expand-10x"` rewrites the output sample rate to `round(sourceRate / 10)`,
 * a lossless time expansion implemented as a header-only change.
 *
 * Yields chunks one at a time so the caller never holds N encoded chunks in
 * memory. The signal is checked twice per chunk: once before encoding and
 * once after yielding. The wavefile encode step on a 24-bit multichannel
 * slice is the largest CPU cost, so an early-abort check before encode is
 * worth the negligible overhead.
 *
 * Wavefile drops non-fmt-and-data chunks (LIST/INFO metadata) at encode time.
 * This matches Kaleidoscope's behaviour and is intentional.
 */
export function* splitWavFile(
  buffer: Uint8Array,
  opts: SplitWavOptions,
): Generator<SplitWavYield> {
  let sourceWav: WaveFile;
  try {
    sourceWav = new WaveFile(buffer);
  } catch {
    yield { kind: "error", code: "invalid-header" };
    return;
  }

  const fmt = sourceWav.fmt as WavFmt;

  if (!isAllowedFormat(fmt)) {
    yield { kind: "error", code: "unsupported-format" };
    return;
  }

  const mapping = mapBitDepth(sourceWav.bitDepth);
  if (mapping === null) {
    yield { kind: "error", code: "unsupported-bit-depth" };
    return;
  }

  const raw = sourceWav.getSamples(false, mapping.Ctor) as unknown as
    | Int16Array
    | Int32Array
    | (Int16Array | Int32Array)[];
  const channels = normalizeChannels(raw);
  const firstChannel = channels[0];
  if (firstChannel === undefined || firstChannel.length === 0) {
    yield { kind: "error", code: "no-samples" };
    return;
  }

  const outputSampleRate =
    opts.mode === "expand-10x"
      ? Math.round(fmt.sampleRate / 10)
      : fmt.sampleRate;
  const chunkSamples = Math.floor(outputSampleRate * opts.chunkSeconds);
  if (chunkSamples <= 0) {
    yield { kind: "error", code: "no-samples" };
    return;
  }

  const totalSamples = firstChannel.length;
  let index = 0;
  const isAborted = (): boolean => opts.signal?.aborted === true;

  for (let offset = 0; offset < totalSamples; offset += chunkSamples) {
    if (isAborted()) {
      yield { kind: "abort" };
      return;
    }

    const end = Math.min(offset + chunkSamples, totalSamples);
    const sliceLength = end - offset;
    const slices = channels.map((ch) => ch.subarray(offset, end));

    const chunkWav = new WaveFile();
    if (slices.length === 1) {
      const slice0 = slices[0];
      if (!slice0) {
        yield { kind: "error", code: "no-samples" };
        return;
      }
      chunkWav.fromScratch(1, outputSampleRate, mapping.bitDepth, slice0);
    } else {
      chunkWav.fromScratch(
        slices.length,
        outputSampleRate,
        mapping.bitDepth,
        slices,
      );
    }

    yield {
      kind: "chunk",
      chunk: {
        index,
        buffer: chunkWav.toBuffer(),
        samplesInChunk: sliceLength,
        outputSampleRate,
        channels: slices.length,
      },
    };

    index += 1;

    if (isAborted()) {
      yield { kind: "abort" };
      return;
    }
  }
}
