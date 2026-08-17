export type RcloneTick = {
  bytesTransferred: number;
  errors: number;
  fatalError: boolean;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

const asNumber = (value: unknown): number | null =>
  typeof value === "number" ? value : null;

/**
 * Parses one line of rclone's `--use-json-log --stats` stderr into a
 * progress tick, or `null` for anything that isn't a usable stats line
 * (blank, non-JSON, or a log line without a `stats` object — rclone emits
 * plenty of those, e.g. transfer-start/error notices).
 *
 * `bytesTransferred` reads `stats.transferring[0].bytes` first, falling
 * back to `stats.bytes` only when no transfer is active (rclone omits
 * `transferring` entirely on the final tick of a run). `stats.totalBytes`
 * and `stats.eta` are deliberately never read anywhere in this module, and
 * that omission is load-bearing, not an oversight a future reader should
 * "fix": measured on real traces (`test-data/rclone-stats/README.md`),
 * `totalBytes` is `0` on the first ticks of a nominal transfer (dividing by
 * it crashes or yields `Infinity`), it never equals the object's real size
 * during a transfer with a retry (it's "bytes already accounted + remainder
 * of the current attempt", a moving denominator), and on a transfer that
 * ultimately *fails*, `stats.bytes / stats.totalBytes` reads exactly `1.0`
 * on the last tick — a bar built on it would show 100% on an error. The
 * caller supplies its own denominator (the local file's known size)
 * instead.
 */
export const parseRcloneStatsLine = (line: string): RcloneTick | null => {
  const trimmed = line.trim();
  if (trimmed === "") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const root = asRecord(parsed);
  if (root === null) return null;

  const stats = asRecord(root.stats);
  if (stats === null) return null;

  const transferring = Array.isArray(stats.transferring)
    ? stats.transferring
    : [];
  const firstTransfer = asRecord(transferring[0]);

  const bytesTransferred =
    (firstTransfer !== null ? asNumber(firstTransfer.bytes) : null) ??
    asNumber(stats.bytes) ??
    0;
  const errors = asNumber(stats.errors) ?? 0;
  const fatalError = stats.fatalError === true;

  return { bytesTransferred, errors, fatalError };
};

export type RcloneStatsReader = {
  push: (chunk: string) => RcloneTick[];
  flush: () => RcloneTick[];
};

/** ~1 MiB. rclone emits one JSON object per line; a fragment that never
 * hits a newline within this budget cannot be a real stats line, so it's
 * dropped rather than left to grow the buffer unboundedly on a stream that
 * never sends `\n`. */
const MAX_BUFFER_LENGTH = 1024 * 1024;

/**
 * Incremental line reader over rclone's stderr, fed by `push` on whatever
 * chunk boundaries the stream happens to deliver — which do not align with
 * line boundaries. Keeps the trailing incomplete-line fragment across
 * `push` calls, and hands it back on `flush` (called on process `close`),
 * since the very last line has no trailing `\n` to trigger it otherwise.
 */
export const createRcloneStatsReader = (): RcloneStatsReader => {
  let buffer = "";

  const push = (chunk: string): RcloneTick[] => {
    buffer += chunk;
    const ticks: RcloneTick[] = [];

    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const tick = parseRcloneStatsLine(line);
      if (tick !== null) ticks.push(tick);
      newlineIndex = buffer.indexOf("\n");
    }

    if (buffer.length > MAX_BUFFER_LENGTH) {
      buffer = "";
    }

    return ticks;
  };

  const flush = (): RcloneTick[] => {
    const tick = parseRcloneStatsLine(buffer);
    buffer = "";
    return tick !== null ? [tick] : [];
  };

  return { push, flush };
};
