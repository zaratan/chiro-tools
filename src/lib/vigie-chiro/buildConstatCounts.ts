import type { ConstatCounts } from "../../types.js";
import { isAlreadyPrefixed } from "./isAlreadyPrefixed.js";
import { isAlreadyCompliant } from "./whitespaceInName.js";

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
  alreadyPrefixed: wavFiles.filter(isAlreadyCompliant).length,
  whitespacePrefixed: wavFiles.filter(
    (name) => isAlreadyPrefixed(name) && !isAlreadyCompliant(name),
  ).length,
  upperCaseWav: wavFiles.filter(
    (name) => !isAlreadyPrefixed(name) && isUpperCaseWavFile(name),
  ).length,
  otherIgnored: ignoredFileCount,
});
