export type SplitErrorCode =
  | "invalid-header"
  | "unsupported-format"
  | "unsupported-bit-depth"
  | "no-samples";

export type SplittableFormat = {
  audioFormat: number;
  subformatTag: number | null;
  bitsPerSample: number;
};

const PCM_AUDIO_FORMAT = 1;
export const EXTENSIBLE_AUDIO_FORMAT = 0xfffe;
const PCM_SUBFORMAT_TAG = 1;

const isIntegerPcm = (fmt: SplittableFormat): boolean =>
  fmt.audioFormat === PCM_AUDIO_FORMAT ||
  (fmt.audioFormat === EXTENSIBLE_AUDIO_FORMAT &&
    fmt.subformatTag === PCM_SUBFORMAT_TAG);

// Vigie-Chiro's analysis chain only takes integer PCM samples.
export const checkSplittable = (
  fmt: SplittableFormat,
): SplitErrorCode | null => {
  if (!isIntegerPcm(fmt)) return "unsupported-format";
  if (fmt.bitsPerSample !== 16 && fmt.bitsPerSample !== 24) {
    return "unsupported-bit-depth";
  }
  return null;
};
