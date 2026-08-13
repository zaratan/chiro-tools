import { describe, expect, it } from "vitest";
import type { ProcessInput } from "../../types.js";
import { CHIRO_VERSION } from "../../version.js";
import type { ProcessResult } from "../audio/processWavFiles.js";
import { buildVigieProcessSessionEvent } from "./buildVigieProcessSessionEvent.js";

const baseOutcome: ProcessResult = {
  processed: [
    {
      sourceFile: "a.wav",
      chunkCount: 3,
      outputSampleRate: 384000,
      channels: 1,
    },
  ],
  errored: [{ file: "b.wav", reason: "ENOENT" }],
  skippedTooLarge: ["c.wav"],
  skippedAlreadyChunked: ["d_001.wav"],
  interrupted: false,
  durationMs: 1234,
  engine: "sox",
  engine_fallback_count: 1,
  metadata: "full",
};

describe("buildVigieProcessSessionEvent", () => {
  it("builds a schema_version 2 vigie-process event with the current CHIRO_VERSION", () => {
    const input: ProcessInput = { mode: "preserve" };

    const event = buildVigieProcessSessionEvent(input, baseOutcome, "/tmp/x");

    expect(event.schema_version).toBe(2);
    expect(event.action).toBe("vigie-process");
    expect(event.version).toBe(CHIRO_VERSION);
    expect(event.cwd).toBe("/tmp/x");
  });

  it("serializes input.mode as-is", () => {
    const input: ProcessInput = { mode: "expand-10x" };

    const event = buildVigieProcessSessionEvent(input, baseOutcome, "/tmp/x");
    if (event.schema_version !== 2) throw new Error("type narrowing");

    expect(event.input).toEqual({ mode: "expand-10x" });
  });

  it("maps each processed file to snake_case fields", () => {
    const input: ProcessInput = { mode: "preserve" };

    const event = buildVigieProcessSessionEvent(input, baseOutcome, "/tmp/x");
    if (event.schema_version !== 2) throw new Error("type narrowing");

    expect(event.result.processed).toEqual([
      {
        source_file: "a.wav",
        chunk_count: 3,
        output_sample_rate: 384000,
        channels: 1,
      },
    ]);
  });

  it("passes through errored, skipped lists, interrupted, duration, engine, and metadata", () => {
    const input: ProcessInput = { mode: "preserve" };

    const event = buildVigieProcessSessionEvent(input, baseOutcome, "/tmp/x");
    if (event.schema_version !== 2) throw new Error("type narrowing");

    expect(event.result.errored).toEqual([{ file: "b.wav", reason: "ENOENT" }]);
    expect(event.result.skipped_too_large).toEqual(["c.wav"]);
    expect(event.result.skipped_already_chunked).toEqual(["d_001.wav"]);
    expect(event.result.interrupted).toBe(false);
    expect(event.result.duration_ms).toBe(1234);
    expect(event.result.engine).toBe("sox");
    expect(event.result.engine_fallback_count).toBe(1);
    expect(event.result.metadata).toBe("full");
  });

  it("stamps a valid ISO 8601 timestamp", () => {
    const input: ProcessInput = { mode: "preserve" };

    const event = buildVigieProcessSessionEvent(input, baseOutcome, "/tmp/x");

    expect(() => new Date(event.ts).toISOString()).not.toThrow();
    expect(new Date(event.ts).toISOString()).toBe(event.ts);
  });
});
