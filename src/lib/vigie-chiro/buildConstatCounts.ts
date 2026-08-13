import type { ConstatCounts } from "../../types.js";
import { isAlreadyPrefixed } from "./isAlreadyPrefixed.js";

const isUpperCaseWavFile = (name: string): boolean => name.endsWith(".WAV");

/**
 * Derives the Vigie-Chiro "constat" counters from a raw wav-file listing:
 * how many are already in the prefixed format (skipped, idempotence), how
 * many still have an uppercase `.WAV` extension (renamed to lowercase), and
 * how many other non-wav files were ignored during the scan.
 */
export const buildConstatCounts = (
  wavFiles: readonly string[],
  ignoredFileCount: number,
): ConstatCounts => ({
  totalWav: wavFiles.length,
  alreadyPrefixed: wavFiles.filter(isAlreadyPrefixed).length,
  upperCaseWav: wavFiles.filter(isUpperCaseWavFile).length,
  otherIgnored: ignoredFileCount,
});
