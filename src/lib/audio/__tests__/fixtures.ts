import { WaveFile } from "wavefile";

export type WavBitDepth = "16" | "24";

export type MakeWavOptions = {
  channels?: number;
  sampleRate?: number;
  bitDepth?: WavBitDepth;
  durationSeconds?: number;
};

/**
 * Returns a Uint8Array WAV with deterministic sample values:
 *   channel c, sample i → ((i * (c + 1)) modulo maxValue) - maxValue/2
 *
 * Useful for asserting sample-exact round-trips. The channel-dependent factor
 * lets multi-channel assertions catch channel-mix-ups.
 */
export const makeRampWav = (opts: MakeWavOptions = {}): Uint8Array => {
  const channels = opts.channels ?? 1;
  const sampleRate = opts.sampleRate ?? 48000;
  const bitDepth = opts.bitDepth ?? "16";
  const durationSeconds = opts.durationSeconds ?? 1;
  const sampleCount = Math.floor(sampleRate * durationSeconds);

  const ArrayCtor = bitDepth === "16" ? Int16Array : Int32Array;
  const maxValue = bitDepth === "16" ? 32768 : 8388608; // 2^15, 2^23
  const halfMax = maxValue / 2;

  const channelData: (Int16Array | Int32Array)[] = [];
  for (let c = 0; c < channels; c++) {
    const data = new ArrayCtor(sampleCount);
    const factor = c + 1;
    for (let i = 0; i < sampleCount; i++) {
      data[i] = ((i * factor) % maxValue) - halfMax;
    }
    channelData.push(data);
  }

  const wav = new WaveFile();
  if (channels === 1) {
    const ch0 = channelData[0];
    if (!ch0) throw new Error("ramp: no channel data");
    wav.fromScratch(1, sampleRate, bitDepth, ch0);
  } else {
    wav.fromScratch(channels, sampleRate, bitDepth, channelData);
  }
  return wav.toBuffer();
};

/**
 * Returns a Uint8Array WAV with a sine wave at `frequency` Hz.
 * Useful only for manual recette in Audacity (audible). Assertions should
 * use `makeRampWav` because sine values floor-round to integers and lose
 * bit-exact comparability.
 */
export const makeSineWav = (
  opts: MakeWavOptions & { frequency?: number } = {},
): Uint8Array => {
  const channels = opts.channels ?? 1;
  const sampleRate = opts.sampleRate ?? 48000;
  const bitDepth = opts.bitDepth ?? "16";
  const durationSeconds = opts.durationSeconds ?? 1;
  const frequency = opts.frequency ?? 440;
  const sampleCount = Math.floor(sampleRate * durationSeconds);

  const amplitude = bitDepth === "16" ? 16000 : 4_000_000;
  const ArrayCtor = bitDepth === "16" ? Int16Array : Int32Array;

  const channelData: (Int16Array | Int32Array)[] = [];
  for (let c = 0; c < channels; c++) {
    const data = new ArrayCtor(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      data[i] = Math.round(
        amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate),
      );
    }
    channelData.push(data);
  }

  const wav = new WaveFile();
  if (channels === 1) {
    const ch0 = channelData[0];
    if (!ch0) throw new Error("sine: no channel data");
    wav.fromScratch(1, sampleRate, bitDepth, ch0);
  } else {
    wav.fromScratch(channels, sampleRate, bitDepth, channelData);
  }
  return wav.toBuffer();
};

/**
 * Returns the per-channel samples of a WAV buffer as the matching TypedArray
 * (Int16Array for "16", Int32Array for "24"/"32"). Normalizes the mono case
 * (where wavefile returns a flat TypedArray instead of [TypedArray]).
 */
export const readSamplesPerChannel = (
  buffer: Uint8Array,
): {
  bitDepth: string;
  channels: number;
  sampleRate: number;
  samples: (Int16Array | Int32Array)[];
} => {
  const wav = new WaveFile(buffer);
  const fmt = wav.fmt as { numChannels: number; sampleRate: number };
  const Ctor: typeof Int16Array | typeof Int32Array =
    wav.bitDepth === "16" ? Int16Array : Int32Array;
  const raw = wav.getSamples(false, Ctor) as unknown as
    Int16Array | Int32Array | (Int16Array | Int32Array)[];
  const samples: (Int16Array | Int32Array)[] = Array.isArray(raw) ? raw : [raw];
  return {
    bitDepth: wav.bitDepth,
    channels: fmt.numChannels,
    sampleRate: fmt.sampleRate,
    samples,
  };
};

export type RawWavOptions = {
  audioFormat?: number;
  bitsPerSample?: number;
  channels?: number;
  sampleRate?: number;
  data?: Uint8Array;
  extensibleSubformat?: number;
  declaredDataSize?: number;
  chunksBefore?: { id: string; payload: Uint8Array }[];
  trailingBytes?: Uint8Array;
};

const riffChunk = (id: string, payload: Uint8Array): Buffer => {
  const header = Buffer.alloc(8);
  header.write(id, 0, "ascii");
  header.writeUInt32LE(payload.byteLength, 4);
  const pad = payload.byteLength % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([header, payload, pad]);
};

export const makeWavBytes = (opts: RawWavOptions = {}): Buffer => {
  const channels = opts.channels ?? 1;
  const sampleRate = opts.sampleRate ?? 48000;
  const bitsPerSample = opts.bitsPerSample ?? 16;
  const data = opts.data ?? new Uint8Array(0);
  const extensible = opts.extensibleSubformat !== undefined;
  const blockAlign = (channels * bitsPerSample) / 8;

  const fmt = Buffer.alloc(extensible ? 40 : 16);
  fmt.writeUInt16LE(extensible ? 0xfffe : (opts.audioFormat ?? 1), 0);
  fmt.writeUInt16LE(channels, 2);
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate * blockAlign, 8);
  fmt.writeUInt16LE(blockAlign, 12);
  fmt.writeUInt16LE(bitsPerSample, 14);
  if (opts.extensibleSubformat !== undefined) {
    fmt.writeUInt16LE(22, 16);
    fmt.writeUInt16LE(bitsPerSample, 18);
    fmt.writeUInt32LE(channels === 1 ? 4 : 3, 20);
    fmt.writeUInt32LE(opts.extensibleSubformat, 24);
    Buffer.from("00001000800000aa00389b71", "hex").copy(fmt, 28);
  }

  const dataHeader = Buffer.alloc(8);
  dataHeader.write("data", 0, "ascii");
  dataHeader.writeUInt32LE(opts.declaredDataSize ?? data.byteLength, 4);

  const body = Buffer.concat([
    Buffer.from("WAVE", "ascii"),
    ...(opts.chunksBefore ?? []).map((c) => riffChunk(c.id, c.payload)),
    riffChunk("fmt ", fmt),
    dataHeader,
    data,
    opts.trailingBytes ?? new Uint8Array(0),
  ]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "ascii");
  riff.writeUInt32LE(body.byteLength, 4);
  return Buffer.concat([riff, body]);
};

export const makeRampBytes = (byteLength: number): Buffer => {
  const bytes = Buffer.alloc(byteLength);
  for (let i = 0; i < byteLength; i++) bytes[i] = (i * 7) % 251;
  return bytes;
};
