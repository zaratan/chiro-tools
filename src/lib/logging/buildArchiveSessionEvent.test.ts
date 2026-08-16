import { describe, expect, it } from "vitest";
import type { CreateZipArchiveResult } from "../archive/createZipArchive.js";
import { CHIRO_VERSION } from "../../version.js";
import { buildArchiveSessionEvent } from "./buildArchiveSessionEvent.js";

describe("buildArchiveSessionEvent", () => {
  it("builds a schema_version 5 vigie-archive event with the current CHIRO_VERSION", () => {
    const result: CreateZipArchiveResult = {
      kind: "ok",
      zipPath: "/tmp/x/archived/processed_202608121430.zip",
      zipBytes: 1234,
      entryCount: 5,
      durationMs: 999,
      durable: true,
    };

    const event = buildArchiveSessionEvent(result, 5, 10_000, 42, "/tmp/x");

    expect(event.schema_version).toBe(5);
    expect(event.action).toBe("vigie-archive");
    expect(event.version).toBe(CHIRO_VERSION);
    expect(event.cwd).toBe("/tmp/x");
    expect(event).not.toHaveProperty("input");
  });

  it("maps an 'ok' result to status ok with zip_name derived from the basename", () => {
    const result: CreateZipArchiveResult = {
      kind: "ok",
      zipPath: "/tmp/x/archived/processed_202608121430.zip",
      zipBytes: 1234,
      entryCount: 5,
      durationMs: 999,
      durable: true,
    };

    const event = buildArchiveSessionEvent(result, 5, 10_000, 42, "/tmp/x");
    if (event.schema_version !== 5) throw new Error("type narrowing");

    expect(event.result).toEqual({
      status: "ok",
      zip_name: "processed_202608121430.zip",
      entry_count: 5,
      total_bytes: 10_000,
      zip_bytes: 1234,
      duration_ms: 42,
      durable: true,
    });
  });

  it("maps an 'aborted' result to status aborted with no zip_name/zip_bytes", () => {
    const result: CreateZipArchiveResult = { kind: "aborted" };

    const event = buildArchiveSessionEvent(result, 3, 5000, 100, "/tmp/x");
    if (event.schema_version !== 5) throw new Error("type narrowing");

    expect(event.result).toEqual({
      status: "aborted",
      entry_count: 3,
      total_bytes: 5000,
      duration_ms: 100,
    });
  });

  it("maps an 'error' result to status error with error_code", () => {
    const result: CreateZipArchiveResult = { kind: "error", code: "ENOSPC" };

    const event = buildArchiveSessionEvent(result, 3, 5000, 100, "/tmp/x");
    if (event.schema_version !== 5) throw new Error("type narrowing");

    expect(event.result).toEqual({
      status: "error",
      error_code: "ENOSPC",
      entry_count: 3,
      total_bytes: 5000,
      duration_ms: 100,
    });
  });

  it("stamps a valid ISO 8601 timestamp", () => {
    const result: CreateZipArchiveResult = { kind: "aborted" };

    const event = buildArchiveSessionEvent(result, 0, 0, 0, "/tmp/x");

    expect(() => new Date(event.ts).toISOString()).not.toThrow();
    expect(new Date(event.ts).toISOString()).toBe(event.ts);
  });
});

describe("buildArchiveSessionEvent — durable is the writer's, not a constant", () => {
  // The whole point of schema v5 is that `durable` reaches the journal. Both
  // builder tests only ever passed `true` and only ever expected `true`, so a
  // hard-coded `durable: true` satisfied them — the mutation the phase-9
  // review found alive on the package side.
  it.each([true, false])("carries durable=%s into the event", (durable) => {
    const event = buildArchiveSessionEvent(
      {
        kind: "ok",
        zipPath: "/tmp/x/archived/z.zip",
        zipBytes: 1,
        durable,
      },
      1,
      1,
      1,
      "/tmp/x",
    );
    if (event.schema_version !== 5) throw new Error("type narrowing");
    if (event.result.status !== "ok") throw new Error("type narrowing");
    expect(event.result.durable).toBe(durable);
  });
});
