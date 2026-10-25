import type {
  FormInput,
  RenameOutcome,
  RenamePlan,
  SessionEvent,
} from "../../types.js";
import { CHIRO_VERSION } from "../../version.js";
import {
  filesWithOtherPrefix,
  summarizeFoundPrefixes,
} from "../vigie-chiro/foundPrefixes.js";
import { buildPrefix } from "../vigie-chiro/prefix.js";

const MAX_LOGGED_PREFIXES = 20;

/** Builds the v7 (`vigie-prefix`) session log entry, ready for `logSession`. */
export const buildVigiePrefixSessionEvent = (
  input: FormInput,
  plan: RenamePlan,
  outcome: RenameOutcome,
  cwd: string,
): SessionEvent => {
  const found = summarizeFoundPrefixes(
    [
      ...plan.operations.map((op) => op.from),
      ...plan.skippedAlreadyPrefixed,
      ...plan.skippedCollision,
    ],
    MAX_LOGGED_PREFIXES,
  );
  return {
    schema_version: 7,
    ts: new Date().toISOString(),
    version: CHIRO_VERSION,
    cwd,
    action: "vigie-prefix",
    input,
    result: {
      renamed:
        outcome.renamed.length +
        outcome.whitespaceFixed.length +
        outcome.reprefixed.length,
      whitespace_fixed: outcome.whitespaceFixed.length,
      reprefixed: outcome.reprefixed.length,
      skipped_already_prefixed: outcome.skippedAlreadyPrefixed.length,
      skipped_collision: outcome.skippedCollision.length,
      other_prefix: filesWithOtherPrefix(plan, buildPrefix(input)).length,
      prefixes_found: found.prefixes,
      prefixes_found_count: found.count,
      errored: outcome.errored,
      interrupted: outcome.interrupted,
      duration_ms: outcome.durationMs,
    },
  };
};
