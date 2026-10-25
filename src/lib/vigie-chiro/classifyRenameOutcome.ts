import type { RenameError, RenameOutcome } from "../../types.js";

export type RenameResultVariant =
  | {
      kind: "interrupted";
      renamedCount: number;
      errored: readonly RenameError[];
      collisions: readonly string[];
    }
  | {
      kind: "partial-errors";
      renamedCount: number;
      errored: readonly RenameError[];
      collisions: readonly string[];
    }
  | { kind: "nothing-to-do"; alreadyCount: number }
  | {
      kind: "nothing-renamed";
      alreadyCount: number;
      collisions: readonly string[];
    }
  | {
      kind: "success";
      renamedCount: number;
      alreadyCount: number;
      collisions: readonly string[];
    };

export const classifyRenameOutcome = (
  outcome: RenameOutcome,
): RenameResultVariant => {
  const renamedCount = outcome.renamed.length;
  const alreadyCount = outcome.skippedAlreadyPrefixed.length;
  const collisions = outcome.skippedCollision;

  if (outcome.interrupted) {
    return {
      kind: "interrupted",
      renamedCount,
      errored: outcome.errored,
      collisions,
    };
  }
  if (outcome.errored.length > 0) {
    return {
      kind: "partial-errors",
      renamedCount,
      errored: outcome.errored,
      collisions,
    };
  }
  if (renamedCount === 0 && collisions.length > 0) {
    return { kind: "nothing-renamed", alreadyCount, collisions };
  }
  if (renamedCount === 0 && alreadyCount > 0) {
    return { kind: "nothing-to-do", alreadyCount };
  }
  return { kind: "success", renamedCount, alreadyCount, collisions };
};
