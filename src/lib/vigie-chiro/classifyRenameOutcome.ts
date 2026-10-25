import type { RenameError, RenameOutcome } from "../../types.js";
import { hasWhitespaceInBaseName } from "./whitespaceInName.js";

type Collisions = {
  collisions: readonly string[];
  collisionsHaveWhitespace: boolean;
};

type Renamed = { renamedCount: number; whitespaceFixedCount: number };

export type RenameResultVariant =
  | ({
      kind: "interrupted";
      errored: readonly RenameError[];
    } & Renamed &
      Collisions)
  | ({
      kind: "partial-errors";
      errored: readonly RenameError[];
    } & Renamed &
      Collisions)
  | { kind: "nothing-to-do"; alreadyCount: number }
  | ({ kind: "nothing-renamed"; alreadyCount: number } & Collisions)
  | ({ kind: "success"; alreadyCount: number } & Renamed & Collisions);

export const classifyRenameOutcome = (
  outcome: RenameOutcome,
): RenameResultVariant => {
  const renamed: Renamed = {
    renamedCount: outcome.renamed.length,
    whitespaceFixedCount: outcome.whitespaceFixed.length,
  };
  const alreadyCount = outcome.skippedAlreadyPrefixed.length;
  const collisions: Collisions = {
    collisions: outcome.skippedCollision,
    collisionsHaveWhitespace: outcome.skippedCollision.some(
      hasWhitespaceInBaseName,
    ),
  };
  const nothingRenamed =
    renamed.renamedCount === 0 && renamed.whitespaceFixedCount === 0;

  if (outcome.interrupted) {
    return {
      kind: "interrupted",
      errored: outcome.errored,
      ...renamed,
      ...collisions,
    };
  }
  if (outcome.errored.length > 0) {
    return {
      kind: "partial-errors",
      errored: outcome.errored,
      ...renamed,
      ...collisions,
    };
  }
  if (nothingRenamed && collisions.collisions.length > 0) {
    return { kind: "nothing-renamed", alreadyCount, ...collisions };
  }
  if (nothingRenamed && alreadyCount > 0) {
    return { kind: "nothing-to-do", alreadyCount };
  }
  return { kind: "success", alreadyCount, ...renamed, ...collisions };
};
