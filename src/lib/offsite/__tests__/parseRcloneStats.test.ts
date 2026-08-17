import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createRcloneStatsReader,
  parseRcloneStatsLine,
  type RcloneTick,
} from "../parseRcloneStats.js";

const FIXTURES_DIR = path.resolve(
  __dirname,
  "../../../../test-data/rclone-stats",
);

const readFixture = (name: string): string =>
  readFileSync(path.join(FIXTURES_DIR, name), "utf8");

/** Replays a full stderr capture through a fresh reader, chunked at a fixed
 * character-count boundary that (deliberately) does not align with line
 * breaks — the adversarial case the incremental buffer exists for. */
const replay = (content: string, chunkSize: number): RcloneTick[] => {
  const reader = createRcloneStatsReader();
  const ticks: RcloneTick[] = [];
  for (let i = 0; i < content.length; i += chunkSize) {
    ticks.push(...reader.push(content.slice(i, i + chunkSize)));
  }
  ticks.push(...reader.flush());
  return ticks;
};

describe("parseRcloneStatsLine", () => {
  it("returns null for an empty line", () => {
    expect(parseRcloneStatsLine("")).toBeNull();
    expect(parseRcloneStatsLine("   ")).toBeNull();
  });

  it("returns null for a non-JSON line", () => {
    expect(parseRcloneStatsLine("not json at all")).toBeNull();
  });

  it("returns null for JSON that has no stats object", () => {
    expect(
      parseRcloneStatsLine(JSON.stringify({ level: "info", msg: "hello" })),
    ).toBeNull();
  });

  it("returns null when stats is present but not an object", () => {
    expect(parseRcloneStatsLine(JSON.stringify({ stats: "nope" }))).toBeNull();
  });

  it("returns null when the JSON root itself is not an object (e.g. a bare number)", () => {
    expect(parseRcloneStatsLine("42")).toBeNull();
  });

  it("reads bytesTransferred from transferring[0].bytes when a transfer is active", () => {
    const line = JSON.stringify({
      stats: {
        bytes: 999_999_999,
        errors: 0,
        fatalError: false,
        transferring: [{ bytes: 42, name: "big.bin" }],
      },
    });
    expect(parseRcloneStatsLine(line)).toEqual({
      bytesTransferred: 42,
      errors: 0,
      fatalError: false,
    });
  });

  it("falls back to stats.bytes when transferring is empty or absent", () => {
    const noTransferring = JSON.stringify({
      stats: { bytes: 12_345, errors: 0, fatalError: false },
    });
    expect(parseRcloneStatsLine(noTransferring)).toEqual({
      bytesTransferred: 12_345,
      errors: 0,
      fatalError: false,
    });

    const emptyTransferring = JSON.stringify({
      stats: {
        bytes: 12_345,
        errors: 0,
        fatalError: false,
        transferring: [],
      },
    });
    expect(parseRcloneStatsLine(emptyTransferring)).toEqual({
      bytesTransferred: 12_345,
      errors: 0,
      fatalError: false,
    });
  });

  it("defaults bytesTransferred to 0 when neither source is a number", () => {
    expect(parseRcloneStatsLine(JSON.stringify({ stats: {} }))).toEqual({
      bytesTransferred: 0,
      errors: 0,
      fatalError: false,
    });
  });

  it("reads errors and fatalError", () => {
    const line = JSON.stringify({
      stats: { bytes: 1, errors: 3, fatalError: true },
    });
    expect(parseRcloneStatsLine(line)).toEqual({
      bytesTransferred: 1,
      errors: 3,
      fatalError: true,
    });
  });

  it("never surfaces totalBytes or eta on the returned tick", () => {
    const line = JSON.stringify({
      stats: {
        bytes: 1,
        totalBytes: 0,
        eta: null,
        errors: 0,
        fatalError: false,
      },
    });
    const tick = parseRcloneStatsLine(line);
    expect(tick).not.toHaveProperty("totalBytes");
    expect(tick).not.toHaveProperty("eta");
  });
});

describe("createRcloneStatsReader", () => {
  it("emits nothing until a full line has been pushed", () => {
    const reader = createRcloneStatsReader();
    const line = JSON.stringify({
      stats: { bytes: 1, errors: 0, fatalError: false },
    });
    expect(reader.push(line.slice(0, 5))).toEqual([]);
    expect(reader.push(line.slice(5))).toEqual([]);
    expect(reader.push("\n")).toEqual([
      { bytesTransferred: 1, errors: 0, fatalError: false },
    ]);
  });

  it("emits multiple ticks from a single push containing several lines", () => {
    const reader = createRcloneStatsReader();
    const line = (bytes: number): string =>
      JSON.stringify({ stats: { bytes, errors: 0, fatalError: false } });
    const ticks = reader.push(`${line(1)}\n${line(2)}\n${line(3)}\n`);
    expect(ticks.map((t) => t.bytesTransferred)).toEqual([1, 2, 3]);
  });

  it("flush returns the trailing line with no terminating newline", () => {
    const reader = createRcloneStatsReader();
    const line = JSON.stringify({
      stats: { bytes: 7, errors: 0, fatalError: false },
    });
    expect(reader.push(line)).toEqual([]);
    expect(reader.flush()).toEqual([
      { bytesTransferred: 7, errors: 0, fatalError: false },
    ]);
  });

  it("flush on an empty/blank residual buffer yields no ticks", () => {
    const reader = createRcloneStatsReader();
    expect(reader.flush()).toEqual([]);
  });

  it("skips blank lines and non-JSON lines interleaved with real stats lines", () => {
    const reader = createRcloneStatsReader();
    const line = JSON.stringify({
      stats: { bytes: 5, errors: 0, fatalError: false },
    });
    const ticks = reader.push(`\nnot json\n${line}\n\n`);
    expect(ticks).toEqual([
      { bytesTransferred: 5, errors: 0, fatalError: false },
    ]);
  });

  it("drops an overlong fragment that never contains a newline, instead of growing forever", () => {
    const reader = createRcloneStatsReader();
    const hugeFragment = "x".repeat(1024 * 1024 + 10);
    expect(reader.push(hugeFragment)).toEqual([]);
    // The buffer was reset — a subsequent full line still parses normally.
    const line = JSON.stringify({
      stats: { bytes: 9, errors: 0, fatalError: false },
    });
    expect(reader.push(`${line}\n`)).toEqual([
      { bytesTransferred: 9, errors: 0, fatalError: false },
    ]);
  });

  it("reconstructs a line whose bytes are split mid-character across chunks", () => {
    // Simulates what a real Node stream delivers once `setEncoding("utf8")`
    // is applied upstream: chunks handed to push() are always valid decoded
    // string fragments, even when the underlying bytes were split inside a
    // multi-byte UTF-8 character. TextDecoder's `stream: true` mode is what
    // gives that guarantee — it buffers a dangling partial sequence instead
    // of emitting a replacement character.
    const payload = JSON.stringify({
      stats: {
        bytes: 1,
        errors: 0,
        fatalError: false,
        lastError: "chemin accentué: /tmp/Pâturage_20260507.wav",
      },
    });
    const line = `${payload}\n`;
    const bytes = new TextEncoder().encode(line);
    const accentIndex = line.indexOf("â");
    expect(accentIndex).toBeGreaterThan(-1);
    // Split one byte into the 2-byte UTF-8 encoding of "â" (0xC3 0xA2) —
    // right in the middle of a multi-byte character.
    const splitIndex =
      Buffer.byteLength(line.slice(0, accentIndex), "utf8") + 1;

    const decoder = new TextDecoder("utf-8");
    const reader = createRcloneStatsReader();
    const firstChunk = decoder.decode(bytes.subarray(0, splitIndex), {
      stream: true,
    });
    const secondChunk = decoder.decode(bytes.subarray(splitIndex));

    const ticks = [...reader.push(firstChunk), ...reader.push(secondChunk)];
    expect(ticks).toEqual([
      { bytesTransferred: 1, errors: 0, fatalError: false },
    ]);
  });
});

describe("createRcloneStatsReader replayed against real fixtures", () => {
  const fixtures = [
    "upload-1gb-nominal.jsonl",
    "copy-with-retry.jsonl",
    "upload-12mb-short.jsonl",
  ];
  const chunkSizes = [1, 7, 4096];

  for (const fixture of fixtures) {
    const content = readFixture(fixture);
    const wholeFileTicks = replay(content, content.length);

    it(`${fixture}: produces the same tick sequence regardless of chunk size`, () => {
      for (const chunkSize of chunkSizes) {
        expect(replay(content, chunkSize)).toEqual(wholeFileTicks);
      }
    });
  }

  it("upload-1gb-nominal.jsonl: 75 ticks, monotonically progressing 0 to 1073741824", () => {
    const ticks = replay(readFixture("upload-1gb-nominal.jsonl"), 4096);
    expect(ticks).toHaveLength(75);
    expect(ticks[0]?.bytesTransferred).toBe(0);
    expect(ticks.at(-1)?.bytesTransferred).toBe(1_073_741_824);
    for (let i = 1; i < ticks.length; i++) {
      const previous = ticks[i - 1];
      const current = ticks[i];
      if (previous === undefined || current === undefined) continue;
      expect(current.bytesTransferred).toBeGreaterThanOrEqual(
        previous.bytesTransferred,
      );
    }
  });

  it("copy-with-retry.jsonl: 3 ticks, last one carries errors: 1", () => {
    const ticks = replay(readFixture("copy-with-retry.jsonl"), 4096);
    expect(ticks).toHaveLength(3);

    // Pinned exact values from the real capture — proof that transferring[0]
    // .bytes (the true per-object progress) is read, not stats.bytes (which
    // accumulates re-sent bytes across retries and would read much higher
    // here: 42000384 and 83972096 respectively for these two ticks).
    expect(ticks[0]).toEqual({
      bytesTransferred: 11_268_096,
      errors: 0,
      fatalError: false,
    });
    expect(ticks[1]).toEqual({
      bytesTransferred: 22_507_520,
      errors: 0,
      fatalError: false,
    });

    const last = ticks[2];
    expect(last?.errors).toBe(1);
    expect(last?.fatalError).toBe(false);
    // No `transferring` array on the final tick: falls back to stats.bytes.
    expect(last?.bytesTransferred).toBe(92_196_864);
  });

  it("upload-12mb-short.jsonl: a transfer that completes inside one stats interval still parses", () => {
    const ticks = replay(readFixture("upload-12mb-short.jsonl"), 4096);
    expect(ticks).toHaveLength(5);
    expect(ticks.every((t) => t.bytesTransferred === 12_582_912)).toBe(true);
    expect(ticks.every((t) => t.errors === 0 && !t.fatalError)).toBe(true);
  });
});
