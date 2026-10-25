import { buildOutDir } from "../audio/batchPlan.js";
import { scanDirectory } from "../fs/scanDirectory.js";
import { isAlreadyCompliant } from "../vigie-chiro/whitespaceInName.js";
import {
  findCommonRecordingPrefix,
  scanProcessedForArchive,
} from "./planArchive.js";

export type BackupRedoSteps = { prefix: boolean; split: boolean };

export const sourcesNeedPrefixing = (wavFiles: readonly string[]): boolean =>
  wavFiles.length === 0 || !wavFiles.every(isAlreadyCompliant);

export const resolveBackupRedoSteps = async (
  cwd: string,
  signal?: AbortSignal,
): Promise<BackupRedoSteps> => {
  const processed = await scanProcessedForArchive(buildOutDir(cwd), signal);
  if (
    processed.kind === "ok" &&
    findCommonRecordingPrefix(processed.entries.map((entry) => entry.name)) !==
      null
  ) {
    return { prefix: false, split: false };
  }
  const sources = await scanDirectory(cwd);
  return {
    prefix: sources.kind !== "ok" || sourcesNeedPrefixing(sources.wavFiles),
    split: true,
  };
};
