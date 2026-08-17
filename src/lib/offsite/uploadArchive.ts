import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { buildRcloneCommand } from "./buildRcloneCommand.js";
import { createRcloneStatsReader } from "./parseRcloneStats.js";
import { buildRemoteObjectPath } from "./remoteStat.js";
import type { RemoteStatParams, RemoteStatResult } from "./remoteStat.js";
import type { OffsiteSettings } from "./settings.js";

export type SpawnRclone = (
  command: string,
  args: readonly string[],
) => ChildProcess;

/** Real spawn, stdout ignored (nothing reads it — progress and every log
 * line come from stderr's `--use-json-log`), stderr piped for parsing. */
export const nodeRcloneSpawn: SpawnRclone = (command, args) =>
  nodeSpawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });

export type RemoteStatFn = (
  params: RemoteStatParams,
) => Promise<RemoteStatResult>;

export type UploadArchiveDeps = {
  /** Injected directly as a function parameter — like `binPath` is for
   * `runSoxBatch` — rather than routed through `App`, so a test can swap in
   * a fake binary without any App-level plumbing. Defaults to the real
   * `node:child_process.spawn`; tests point `rcloneBinPath` at a fake shell
   * script instead of swapping this. */
  spawn: SpawnRclone;
  /** The verification call is a second appeal to the same binary/config —
   * injected so tests control what "the vault says" without spawning
   * anything a second time. */
  remoteStat: RemoteStatFn;
};

export type UploadArchiveOptions = {
  rcloneBinPath: string;
  platform: NodeJS.Platform;
  settings: OffsiteSettings;
  key: string;
  localPath: string;
  /** The denominator progress is measured against. Never rclone's own
   * `totalBytes` — measured on real traces (`test-data/rclone-stats/`) to be
   * `0` on the first ticks of a nominal transfer, and to never equal the
   * object's real size once a retry has happened. The caller already knows
   * this value (it just `stat`ed the zip to pick it). */
  localBytes: number;
  signal?: AbortSignal;
  /** Delay before the automatic SIGINT resend, and before the final
   * SIGKILL, both counted from the moment `signal` fires. Overridable so
   * tests can bound a run against an rclone that ignores SIGINT without
   * waiting on the real 15 s. */
  sigintResendMs?: number;
  killEscalationMs?: number;
  /** Clamped monotone bytes transferred — never emits a value lower than
   * the last one, even when a retry makes rclone's own counters jump back. */
  onProgress?: (bytesTransferred: number) => void;
};

export type UploadArchiveResult =
  | {
      kind: "ok";
      bytesSent: number;
      attempts: number;
      /** "unavailable" is a **success** variant, not a lesser one: failing
       * to re-read the object after a transfer that reported success is not
       * evidence the transfer failed. Announcing an error to someone whose
       * multi-hour upload actually worked is the most expensive lie this
       * flow could tell (see `docs/architecture.md` § offsite). */
      verified: "size-match" | "unavailable";
    }
  | { kind: "aborted"; bytesSent: number }
  | { kind: "error"; code: string; bytesSent: number; fatalError: boolean };

const DEFAULT_SIGINT_RESEND_MS = 5000;
const DEFAULT_KILL_ESCALATION_MS = 15_000;

// Only these two codes are stats-bearing JSON lines that `parseRcloneStats`
// already recognises. Every other "Attempt N/M failed" notice rclone emits
// under --use-json-log carries no `stats` object and is invisible to that
// parser by design — it is scanned for here, separately, on the raw text.
const ATTEMPT_FAILED_PATTERN = /"msg":"Attempt (\d+)\/\d+ failed/g;
const MAX_ATTEMPT_SCAN_BUFFER = 64 * 1024;

const buildUploadArgs = (
  settings: OffsiteSettings,
  key: string,
  localPath: string,
): string[] => [
  "copyto",
  localPath,
  buildRemoteObjectPath(settings, key),
  "--s3-storage-class",
  "GLACIER",
  "--s3-chunk-size",
  "64Mi",
  "--s3-upload-concurrency",
  "8",
  "--low-level-retries",
  "20",
  "--retries",
  "3",
  "--use-json-log",
  "--stats",
  "1s",
  "--stats-log-level",
  "NOTICE",
];

/**
 * Transfers the archive and verifies it landed — one call for the caller,
 * so no upload/verify business logic has to live in a screen.
 *
 * **Abort.** `signal` firing sends SIGINT immediately (rclone exits 130,
 * measured in ~0.16 s, with no final stats tick — the process handles the
 * signal itself and never reports one back to us). This module then
 * escalates on its own, automatically: a second SIGINT at `sigintResendMs`
 * in case the first was dropped or ignored, a hard SIGKILL at
 * `killEscalationMs`. SIGINT rather than an immediate SIGKILL, because a
 * SIGKILL leaves multipart uploads unfinished and *billed*; SIGINT gives
 * rclone the chance to abandon them cleanly. (The plan's "1st/2nd/3rd call
 * to abort" describes the full picture once a future screen's Ctrl+C
 * handler is layered on top — this module owns the automatic half of that
 * escalation; a UI driving repeated key-presses is 10.B2's concern, not
 * this one.)
 *
 * **The race that must not be lost.** rclone can still exit `0` in the
 * window between the abort firing and the signal landing — the object is
 * then genuinely in the bucket. So after an abort, the exit code is still
 * consulted: `0` is a success, exactly as on the non-aborted path. Reporting
 * "cancelled" and writing nothing would make a future run re-offer sending
 * an already-present multi-GB object.
 *
 * **Verification.** On a `0` exit, `remoteStat` is asked once, and the split
 * between its outcomes is epistemic: a definite answer can fail the run, an
 * absence of answer never can.
 * - size matches → `verified: "size-match"`.
 * - present at a *different* size → `verify-failed`.
 * - `absent` → `verify-absent`. The store answered and said no; that is not
 *   uncertainty. Its realistic cause is a key-construction mismatch, whose
 *   only symptom is precisely this.
 * - anything that yielded **no answer** (network, timeout, bucket/config
 *   trouble, an abort racing the transfer) → `verified: "unavailable"` on a
 *   **success**, never an error; see the type's own comment.
 */
export const uploadArchive = async (
  deps: UploadArchiveDeps,
  options: UploadArchiveOptions,
): Promise<UploadArchiveResult> => {
  const {
    rcloneBinPath,
    platform,
    settings,
    key,
    localPath,
    localBytes,
    signal,
    onProgress,
  } = options;
  const sigintResendMs = options.sigintResendMs ?? DEFAULT_SIGINT_RESEND_MS;
  const killEscalationMs =
    options.killEscalationMs ?? DEFAULT_KILL_ESCALATION_MS;

  const { command, args } = buildRcloneCommand(
    platform,
    rcloneBinPath,
    buildUploadArgs(settings, key, localPath),
  );

  let child: ChildProcess;
  try {
    child = deps.spawn(command, args);
  } catch {
    return {
      kind: "error",
      code: "rclone-spawn-failed",
      bytesSent: 0,
      fatalError: false,
    };
  }

  if (child.stderr === null) {
    child.kill("SIGKILL");
    return {
      kind: "error",
      code: "rclone-spawn-failed",
      bytesSent: 0,
      fatalError: false,
    };
  }
  child.stderr.setEncoding("utf8");

  const statsReader = createRcloneStatsReader();
  let shownBytes = 0;
  let sawFatalError = false;
  let attemptScanBuffer = "";
  let maxAttemptSeen = 0;

  const applyTicks = (
    ticks: { bytesTransferred: number; fatalError: boolean }[],
  ): void => {
    for (const tick of ticks) {
      shownBytes = Math.max(shownBytes, tick.bytesTransferred);
      if (tick.fatalError) sawFatalError = true;
      onProgress?.(shownBytes);
    }
  };

  const scanAttempts = (chunk: string): void => {
    attemptScanBuffer += chunk;
    if (attemptScanBuffer.length > MAX_ATTEMPT_SCAN_BUFFER) {
      attemptScanBuffer = attemptScanBuffer.slice(-MAX_ATTEMPT_SCAN_BUFFER);
    }
    ATTEMPT_FAILED_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = ATTEMPT_FAILED_PATTERN.exec(attemptScanBuffer)) !== null) {
      const captured = match[1];
      if (captured === undefined) continue;
      const n = Number(captured);
      if (n > maxAttemptSeen) maxAttemptSeen = n;
    }
  };

  child.stderr.on("data", (chunk: string) => {
    applyTicks(statsReader.push(chunk));
    scanAttempts(chunk);
  });

  let abortRequested = false;
  let resendTimer: ReturnType<typeof setTimeout> | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;

  const clearEscalationTimers = (): void => {
    if (resendTimer !== undefined) clearTimeout(resendTimer);
    if (killTimer !== undefined) clearTimeout(killTimer);
  };

  const onAbort = (): void => {
    abortRequested = true;
    child.kill("SIGINT");
    resendTimer = setTimeout(() => {
      child.kill("SIGINT");
    }, sigintResendMs);
    killTimer = setTimeout(() => {
      child.kill("SIGKILL");
    }, killEscalationMs);
  };

  if (signal?.aborted === true) {
    onAbort();
  } else {
    signal?.addEventListener("abort", onAbort, { once: true });
  }

  return new Promise<UploadArchiveResult>((resolve) => {
    let settled = false;
    const finish = (result: UploadArchiveResult): void => {
      if (settled) return;
      settled = true;
      clearEscalationTimers();
      signal?.removeEventListener("abort", onAbort);
      resolve(result);
    };

    child.on("error", () => {
      finish({
        kind: "error",
        code: "rclone-spawn-failed",
        bytesSent: shownBytes,
        fatalError: sawFatalError,
      });
    });

    child.on("close", (code) => {
      applyTicks(statsReader.flush());

      // 0 always wins, whether or not we asked to abort: rclone can exit
      // successfully in the window between the signal firing and it
      // landing, and the object is then genuinely in the bucket.
      if (code === 0) {
        const attempts = maxAttemptSeen > 0 ? maxAttemptSeen + 1 : 1;
        void verifyAndResolve(
          deps.remoteStat,
          settings,
          key,
          localBytes,
          shownBytes,
          attempts,
          signal,
          finish,
        );
        return;
      }

      // 130 is rclone's own exit code for "I handled SIGINT" — it is
      // recognised on its own, not gated on `abortRequested`, because
      // Node's `signal` argument is always `null` here (rclone converts the
      // OS signal into this clean exit itself) and can't be used instead.
      // Any other non-zero exit reached after *we* asked to abort (notably
      // the `null` code left by our own escalation SIGKILL once rclone
      // ignored SIGINT) is an abort too.
      if (code === 130 || abortRequested) {
        finish({ kind: "aborted", bytesSent: shownBytes });
        return;
      }

      if (code === 3) {
        finish({
          kind: "error",
          code: "bucket-missing",
          bytesSent: shownBytes,
          fatalError: sawFatalError,
        });
        return;
      }
      if (code === 1) {
        finish({
          kind: "error",
          code: "config-error",
          bytesSent: shownBytes,
          fatalError: sawFatalError,
        });
        return;
      }
      if (code === 5) {
        finish({
          kind: "error",
          code: "transient",
          bytesSent: shownBytes,
          fatalError: sawFatalError,
        });
        return;
      }
      if (code === 7) {
        finish({
          kind: "error",
          code: "fatal",
          bytesSent: shownBytes,
          fatalError: sawFatalError,
        });
        return;
      }
      finish({
        kind: "error",
        code: `rclone-exit:${String(code ?? "signal")}`,
        bytesSent: shownBytes,
        fatalError: sawFatalError,
      });
    });
  });
};

const verifyAndResolve = async (
  remoteStatFn: RemoteStatFn,
  settings: OffsiteSettings,
  key: string,
  localBytes: number,
  bytesSent: number,
  attempts: number,
  signal: AbortSignal | undefined,
  finish: (result: UploadArchiveResult) => void,
): Promise<void> => {
  const stat = await remoteStatFn({ settings, key, signal });

  if (stat.kind === "present" && stat.bytes === localBytes) {
    finish({ kind: "ok", bytesSent, attempts, verified: "size-match" });
    return;
  }

  // The line this split draws is epistemic, and it is the whole point of the
  // `verified` field: "we got no answer" is not "we got an answer and it says
  // no". Only the former is uncertainty, and only uncertainty is allowed to
  // ride along with a success.
  //
  // A present object of a different size is one known size disagreeing with
  // another — actionable, and the case the plan names.
  if (stat.kind === "present") {
    finish({
      kind: "error",
      code: "verify-failed",
      bytesSent,
      fatalError: false,
    });
    return;
  }

  // An `absent` readback is a *definite negative*: the store answered, and it
  // said the object is not there. It does not belong with the network/timeout
  // /abort cases below, for two reasons. Scaleway, like S3 since 2020, is
  // strongly read-after-write consistent, so this is not an expected lag. And
  // the realistic cause is a key-construction mismatch — writing to one path
  // and reading back another — whose only symptom is exactly this. Folding it
  // into a success would disguise a bug that archives nothing while reporting
  // that everything is safe.
  //
  // The cost asymmetry settles it: a false alarm costs one needless re-upload,
  // whereas a false all-clear on a backup feature is discovered years later,
  // when the vault turns out to be empty.
  if (stat.kind === "absent") {
    finish({
      kind: "error",
      code: "verify-absent",
      bytesSent,
      fatalError: false,
    });
    return;
  }

  finish({ kind: "ok", bytesSent, attempts, verified: "unavailable" });
};
