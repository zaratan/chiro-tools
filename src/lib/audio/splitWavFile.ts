import { WaveFile } from "wavefile";
import type { TimeExpansionMode } from "../../types.js";
import { checkSplittable, type SplitErrorCode } from "./wavFormat.js";

export type SplitWavOptions = {
  mode: TimeExpansionMode;
  chunkSeconds: number;
};

export type EncodedChunk = {
  index: number;
  buffer: Uint8Array;
  samplesInChunk: number;
  outputSampleRate: number;
  channels: number;
};

export type SplitWavYield =
  | { kind: "chunk"; chunk: EncodedChunk }
  | { kind: "error"; code: SplitErrorCode };

type WavFmt = {
  audioFormat: number;
  sampleRate: number;
  bitsPerSample: number;
  subformat: number[];
};

type BitDepthMapping = {
  bitDepth: "16" | "24";
  Ctor: typeof Int16Array | typeof Int32Array;
};

const mapBitDepth = (bitsPerSample: number): BitDepthMapping =>
  bitsPerSample === 24
    ? { bitDepth: "24", Ctor: Int32Array }
    : { bitDepth: "16", Ctor: Int16Array };

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

  const formatError = checkSplittable({
    audioFormat: fmt.audioFormat,
    subformatTag: fmt.subformat[0] ?? null,
    bitsPerSample: fmt.bitsPerSample,
  });
  if (formatError !== null) {
    yield { kind: "error", code: formatError };
    return;
  }

  const mapping = mapBitDepth(fmt.bitsPerSample);

  const raw = sourceWav.getSamples(false, mapping.Ctor) as unknown as
    Int16Array | Int32Array | (Int16Array | Int32Array)[];
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

  for (let offset = 0; offset < totalSamples; offset += chunkSamples) {
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
  }
}
