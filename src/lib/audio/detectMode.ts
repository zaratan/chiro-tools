import type { TimeExpansionMode } from "../../types.js";

// TeensyRecorder firmware: an Exp10 file declares its rate divided by 10
// (CWaveFile.cpp:65-67), an X1 file a rate from 24 000 Hz up (CRecorder.cpp:446-472).
const X10_SAMPLE_RATES: ReadonlySet<number> = new Set([
  2400, 4800, 9600, 19200, 25000, 38400, 50000,
]);
const LOWEST_X1_SAMPLE_RATE = 24000;

export type SampleRateClass = TimeExpansionMode | "unclassifiable";

export const classifySampleRate = (sampleRate: number): SampleRateClass => {
  if (X10_SAMPLE_RATES.has(sampleRate)) return "preserve";
  if (sampleRate >= LOWEST_X1_SAMPLE_RATE) return "expand-10x";
  return "unclassifiable";
};

export type RecordingRate = { file: string; sampleRate: number };

export type BatchModeDetection =
  | { kind: "ok"; mode: TimeExpansionMode }
  | { kind: "empty" }
  | { kind: "unclassifiable"; files: RecordingRate[] }
  | { kind: "mixed"; preserve: RecordingRate[]; expand: RecordingRate[] };

export const detectBatchMode = (
  recordings: readonly RecordingRate[],
): BatchModeDetection => {
  const preserve: RecordingRate[] = [];
  const expand: RecordingRate[] = [];
  const unclassifiable: RecordingRate[] = [];
  for (const recording of recordings) {
    const rateClass = classifySampleRate(recording.sampleRate);
    if (rateClass === "preserve") preserve.push(recording);
    else if (rateClass === "expand-10x") expand.push(recording);
    else unclassifiable.push(recording);
  }

  if (unclassifiable.length > 0) {
    return { kind: "unclassifiable", files: unclassifiable };
  }
  if (preserve.length > 0 && expand.length > 0) {
    return { kind: "mixed", preserve, expand };
  }
  if (preserve.length > 0) return { kind: "ok", mode: "preserve" };
  if (expand.length > 0) return { kind: "ok", mode: "expand-10x" };
  return { kind: "empty" };
};
