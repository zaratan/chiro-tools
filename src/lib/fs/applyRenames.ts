import path from "node:path";
import type { RenameError, RenameOutcome, RenamePlan } from "../../types.js";
import { isTargetTakenByAnotherFile } from "./isTargetTaken.js";
import { renameWithFallback, type RenameFsLike } from "./safeFsOps.js";

/**
 * Minimal filesystem surface needed to execute a rename plan.
 * Exposed so tests can inject mocks for hard-to-reproduce conditions (e.g. EXDEV).
 */
export type FsLike = RenameFsLike;

export type ApplyOptions = {
  /**
   * If aborted, the loop stops *before* the next iteration.
   * The currently-running rename cannot be interrupted mid-syscall; the loop
   * checks `signal.aborted` between operations.
   */
  signal?: AbortSignal;
  /**
   * Filesystem implementation override. Defaults to `node:fs/promises`.
   */
  fs?: FsLike;
};

/**
 * Executes a rename plan, returning a structured outcome (never throws).
 *
 * Behavior per operation:
 * - Pre-check: if another file already holds the target path → report
 *   `EEXIST` and skip the rename. This guards against case-insensitive FS
 *   collisions that surface only AFTER a previous rename in this batch.
 * - Atomic rename via `fs.rename`. On `EXDEV` (cross-device, typical when
 *   the source is on a removable SD card), fall back to `copyFile + unlink`.
 *   If `unlink` fails after a successful `copyFile`, the file is recorded as
 *   `DUPLICATED (<original code>)` and source is left in place.
 * - Any other I/O error code is recorded against the file; the loop continues.
 *
 * Skipped buckets from the input plan are propagated verbatim to the outcome.
 */
export const applyRenames = async (
  plan: RenamePlan,
  dir: string,
  options?: ApplyOptions,
): Promise<RenameOutcome> => {
  const signal = options?.signal;
  const start = performance.now();

  const renamed: string[] = [];
  const whitespaceFixed: string[] = [];
  const reprefixed: string[] = [];
  const bucketOf = {
    prefix: renamed,
    whitespace: whitespaceFixed,
    reprefix: reprefixed,
  };
  const errored: RenameError[] = [];
  let interrupted = false;

  for (const op of plan.operations) {
    if (signal?.aborted === true) {
      interrupted = true;
      break;
    }

    const absFrom = path.join(dir, op.from);
    const absTo = path.join(dir, op.to);

    if (await isTargetTakenByAnotherFile(absFrom, absTo)) {
      errored.push({ file: op.from, reason: "EEXIST" });
      continue;
    }

    const result = await renameWithFallback(absFrom, absTo, {
      fs: options?.fs,
    });

    if (result.kind === "ok") {
      bucketOf[op.kind].push(op.from);
    } else {
      errored.push({ file: op.from, reason: result.code });
    }
  }

  const durationMs = performance.now() - start;

  return {
    renamed,
    whitespaceFixed,
    reprefixed,
    skippedAlreadyPrefixed: plan.skippedAlreadyPrefixed,
    skippedCollision: plan.skippedCollision,
    errored,
    interrupted,
    durationMs,
  };
};
