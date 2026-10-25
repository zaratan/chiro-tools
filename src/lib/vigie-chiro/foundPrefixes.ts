import type { RenamePlan } from "../../types.js";
import { extractVigiePrefix } from "./isAlreadyPrefixed.js";

export const filesWithOtherPrefix = (
  plan: RenamePlan,
  prefix: string,
): string[] =>
  [...plan.operations.map((op) => op.from), ...plan.skippedCollision]
    .filter((file) => {
      const found = extractVigiePrefix(file);
      return found !== null && found !== prefix;
    })
    .sort();

export const summarizeFoundPrefixes = (
  files: readonly string[],
  limit: number,
): { prefixes: string[]; count: number } => {
  const distinct = [
    ...new Set(files.map(extractVigiePrefix).filter((found) => found !== null)),
  ].sort();
  return { prefixes: distinct.slice(0, limit), count: distinct.length };
};

export const oneOfEachPrefixFirst = <T extends { from: string }>(
  items: readonly T[],
): T[] => {
  const seen = new Set<string | null>();
  const firsts = items.filter((item) => {
    const prefix = extractVigiePrefix(item.from);
    if (seen.has(prefix)) return false;
    seen.add(prefix);
    return true;
  });
  return [...firsts, ...items.filter((item) => !firsts.includes(item))];
};
