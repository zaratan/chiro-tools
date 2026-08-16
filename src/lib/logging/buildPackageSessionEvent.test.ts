import { describe, expect, it } from "vitest";
import type { CreateZipVolumesResult } from "../archive/createZipVolumes.js";
import { CHIRO_VERSION } from "../../version.js";
import { buildPackageSessionEvent } from "./buildPackageSessionEvent.js";

const okResult: CreateZipVolumesResult = {
  kind: "ok",
  seriesDirPath: "/tmp/x/upload/Car340581-2026-Pass1-A1_20260814",
  seriesDirName: "Car340581-2026-Pass1-A1_20260814",
  volumes: [
    {
      fileName: "Car340581-2026-Pass1-A1_part1.zip",
      zipBytes: 100,
      entryCount: 3,
    },
    {
      fileName: "Car340581-2026-Pass1-A1_part2.zip",
      zipBytes: 200,
      entryCount: 4,
    },
  ],
  entryCount: 7,
  totalZipBytes: 300,
  durationMs: 999,
  durable: true,
};

describe("buildPackageSessionEvent", () => {
  it("builds a schema_version 4 vigie-package event with the current CHIRO_VERSION", () => {
    const event = buildPackageSessionEvent(
      okResult,
      7,
      10_000,
      42,
      "/tmp/x",
      3.5 * 1024 ** 3,
    );

    expect(event.schema_version).toBe(4);
    expect(event.action).toBe("vigie-package");
    expect(event.version).toBe(CHIRO_VERSION);
    expect(event.cwd).toBe("/tmp/x");
    expect(event).not.toHaveProperty("input");
  });

  it("maps an 'ok' result to status ok with series_dir derived from the basename", () => {
    const event = buildPackageSessionEvent(
      okResult,
      7,
      10_000,
      42,
      "/tmp/x",
      3.5 * 1024 ** 3,
    );
    if (event.schema_version !== 4) throw new Error("type narrowing");

    expect(event.result).toEqual({
      status: "ok",
      series_dir: "Car340581-2026-Pass1-A1_20260814",
      volume_count: 2,
      volumes: [
        {
          name: "Car340581-2026-Pass1-A1_part1.zip",
          entry_count: 3,
          zip_bytes: 100,
        },
        {
          name: "Car340581-2026-Pass1-A1_part2.zip",
          entry_count: 4,
          zip_bytes: 200,
        },
      ],
      max_volume_bytes: 3.5 * 1024 ** 3,
      entry_count: 7,
      total_bytes: 10_000,
      duration_ms: 42,
      durable: true,
    });
  });

  it("truncates the volumes list to 50 entries while volume_count stays the true count", () => {
    const manyVolumes = Array.from({ length: 60 }, (_, i) => ({
      fileName: `depot_20260814_part${(i + 1).toString().padStart(2, "0")}.zip`,
      zipBytes: 10,
      entryCount: 1,
    }));
    const result: CreateZipVolumesResult = {
      ...okResult,
      volumes: manyVolumes,
      entryCount: 60,
    };

    const event = buildPackageSessionEvent(
      result,
      60,
      60_000,
      1,
      "/tmp/x",
      1000,
    );
    if (event.schema_version !== 4 || event.result.status !== "ok") {
      throw new Error("type narrowing");
    }

    expect(event.result.volume_count).toBe(60);
    expect(event.result.volumes).toHaveLength(50);
  });

  it("maps an 'aborted' result to status aborted with no series_dir/volumes", () => {
    const result: CreateZipVolumesResult = { kind: "aborted" };

    const event = buildPackageSessionEvent(
      result,
      3,
      5000,
      100,
      "/tmp/x",
      1000,
    );
    if (event.schema_version !== 4) throw new Error("type narrowing");

    expect(event.result).toEqual({
      status: "aborted",
      max_volume_bytes: 1000,
      entry_count: 3,
      total_bytes: 5000,
      duration_ms: 100,
    });
  });

  it("maps an 'error' result to status error with error_code", () => {
    const result: CreateZipVolumesResult = { kind: "error", code: "ENOSPC" };

    const event = buildPackageSessionEvent(
      result,
      3,
      5000,
      100,
      "/tmp/x",
      1000,
    );
    if (event.schema_version !== 4) throw new Error("type narrowing");

    expect(event.result).toEqual({
      status: "error",
      error_code: "ENOSPC",
      max_volume_bytes: 1000,
      entry_count: 3,
      total_bytes: 5000,
      duration_ms: 100,
    });
  });

  it("stamps a valid ISO 8601 timestamp", () => {
    const result: CreateZipVolumesResult = { kind: "aborted" };

    const event = buildPackageSessionEvent(result, 0, 0, 0, "/tmp/x", 1000);

    expect(() => new Date(event.ts).toISOString()).not.toThrow();
    expect(new Date(event.ts).toISOString()).toBe(event.ts);
  });
});

describe("buildPackageSessionEvent — durable is the runner's, not a constant", () => {
  // Same reason as the archive builder: every existing case passes and
  // expects `true`, so a hard-coded `true` would satisfy them all. `durable`
  // is what a future destructive flow stands on; it must be shown to travel.
  it.each([true, false])("carries durable=%s into the event", (durable) => {
    const event = buildPackageSessionEvent(
      {
        kind: "ok",
        seriesDirPath: "/tmp/x/upload/depot_20260814",
        seriesDirName: "depot_20260814",
        volumes: [
          { fileName: "depot_20260814.zip", zipBytes: 1, entryCount: 1 },
        ],
        entryCount: 1,
        totalZipBytes: 1,
        durationMs: 1,
        durable,
      },
      1,
      1,
      1,
      "/tmp/x",
      1024,
    );
    if (event.schema_version !== 4) throw new Error("type narrowing");
    if (event.result.status !== "ok") throw new Error("type narrowing");
    expect(event.result.durable).toBe(durable);
  });
});
