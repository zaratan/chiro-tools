import path from "node:path";
import { isAlreadyPrefixed, removeVigiePrefix } from "./isAlreadyPrefixed.js";

const WHITESPACE = /\s/gu;

const WAV_EXTENSION = /\.wav$/i;

export const replaceWhitespaceInBaseName = (relPath: string): string => {
  const base = path.basename(relPath);
  const fixed = base.replace(WHITESPACE, "_");
  return fixed === base ? relPath : path.join(path.dirname(relPath), fixed);
};

export const hasWhitespaceInBaseName = (relPath: string): boolean =>
  replaceWhitespaceInBaseName(relPath) !== relPath;

export const isAlreadyCompliant = (relPath: string): boolean =>
  isAlreadyPrefixed(relPath) && !hasWhitespaceInBaseName(relPath);

export const countRecordingsWithWhitespace = (
  names: readonly string[],
): number =>
  names.filter(
    (name) => WAV_EXTENSION.test(name) && hasWhitespaceInBaseName(name),
  ).length;

const twinKey = (relPath: string, baseName: string): string =>
  path.join(
    path.dirname(relPath),
    replaceWhitespaceInBaseName(baseName).replace(WAV_EXTENSION, ""),
  );

export const findWhitespaceNamesBlockedByPrefixed = (
  wavFiles: readonly string[],
): string[] => {
  const prefixedTwins = new Set(
    wavFiles
      .filter(isAlreadyPrefixed)
      .map((relPath) =>
        twinKey(relPath, removeVigiePrefix(path.basename(relPath))),
      ),
  );
  const names = new Set(wavFiles);
  return wavFiles.filter((relPath) => {
    if (!hasWhitespaceInBaseName(relPath)) return false;
    return isAlreadyPrefixed(relPath)
      ? names.has(replaceWhitespaceInBaseName(relPath))
      : prefixedTwins.has(twinKey(relPath, path.basename(relPath)));
  });
};
