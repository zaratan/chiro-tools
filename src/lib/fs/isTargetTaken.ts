import { stat } from "node:fs/promises";

const statOrNull = async (
  filePath: string,
): Promise<{ dev: number; ino: number } | null> => {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
};

// On a case-insensitive disk, a target that differs from the source only by
// case is the source itself.
export const isTargetTakenByAnotherFile = async (
  absFrom: string,
  absTo: string,
): Promise<boolean> => {
  const target = await statOrNull(absTo);
  if (target === null) return false;
  if (absFrom.toLowerCase() !== absTo.toLowerCase()) return true;
  const source = await statOrNull(absFrom);
  return source?.dev !== target.dev || source.ino !== target.ino;
};
