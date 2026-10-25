import path from "node:path";

const RECORDER_SCRATCH_REGEX =
  /^(?:Car\d{6}-\d{4}-Pass\d+-[^-]+-)?(?:temp|test)\.wav$/i;

// Teensy firmware: temp.wav while recording, Test.wav for the SD speed test.
export const isRecorderScratchFile = (relPath: string): boolean =>
  RECORDER_SCRATCH_REGEX.test(path.basename(relPath));
