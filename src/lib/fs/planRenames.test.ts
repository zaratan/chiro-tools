import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planRenames } from "./planRenames.js";

describe("planRenames", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-test-plan-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty buckets for an empty file list", async () => {
    const result = await planRenames([], "Car040962-2026-Pass3-A1-", tmpDir);
    expect(result).toEqual({
      operations: [],
      skippedAlreadyPrefixed: [],
      skippedCollision: [],
    });
  });

  it("builds operations for 3 raw files with no collisions", async () => {
    const files = [
      "PaRecPR123_20260507_210004.wav",
      "PaRecPR123_20260507_210009.wav",
      "PaRecPR123_20260507_210011.wav",
    ];
    const prefix = "Car040962-2026-Pass3-A1-";

    const result = await planRenames(files, prefix, tmpDir);

    expect(result.skippedAlreadyPrefixed).toEqual([]);
    expect(result.skippedCollision).toEqual([]);
    expect(result.operations).toEqual([
      {
        from: "PaRecPR123_20260507_210004.wav",
        to: "Car040962-2026-Pass3-A1-PaRecPR123_20260507_210004.wav",
      },
      {
        from: "PaRecPR123_20260507_210009.wav",
        to: "Car040962-2026-Pass3-A1-PaRecPR123_20260507_210009.wav",
      },
      {
        from: "PaRecPR123_20260507_210011.wav",
        to: "Car040962-2026-Pass3-A1-PaRecPR123_20260507_210011.wav",
      },
    ]);
  });

  it("puts already-prefixed files into skippedAlreadyPrefixed", async () => {
    const files = [
      "Car040962-2026-Pass3-A1-old.wav",
      "PaRecPR123_20260507_210004.wav",
    ];
    const prefix = "Car040962-2026-Pass3-A1-";

    const result = await planRenames(files, prefix, tmpDir);

    expect(result.skippedAlreadyPrefixed).toEqual([
      "Car040962-2026-Pass3-A1-old.wav",
    ]);
    expect(result.operations).toEqual([
      {
        from: "PaRecPR123_20260507_210004.wav",
        to: "Car040962-2026-Pass3-A1-PaRecPR123_20260507_210004.wav",
      },
    ]);
    expect(result.skippedCollision).toEqual([]);
  });

  it("normalizes .WAV extension to .wav in the target name", async () => {
    const result = await planRenames(["FOO.WAV"], "P-", tmpDir);

    expect(result.operations).toEqual([{ from: "FOO.WAV", to: "P-FOO.wav" }]);
  });

  it("puts a file in skippedCollision when its target already exists on disk", async () => {
    const prefix = "Car040962-2026-Pass3-A1-";
    const targetName = `${prefix}recording.wav`;

    // Pre-create the target file to simulate an external collision
    await writeFile(path.join(tmpDir, targetName), "");

    const result = await planRenames(["recording.wav"], prefix, tmpDir);

    expect(result.operations).toEqual([]);
    expect(result.skippedCollision).toEqual(["recording.wav"]);
  });

  it("handles intra-plan collision when two sources produce the same target (case-insensitive stems on APFS)", async () => {
    // "foo.WAV" and "foo.wav" both normalize to target "P-foo.wav".
    // "foo.WAV" sorts before "foo.wav" in ASCII order (uppercase W < lowercase w), so it wins.
    const result = await planRenames(["foo.wav", "foo.WAV"], "P-", tmpDir);

    expect(result.operations).toEqual([{ from: "foo.WAV", to: "P-foo.wav" }]);
    expect(result.skippedCollision).toEqual(["foo.wav"]);
  });

  it("does NOT create intra-plan collisions for files with different stems in different cases", async () => {
    // "FOO.wav" → "P-FOO.wav" and "foo.wav" → "P-foo.wav" are distinct targets.
    // No collision should be reported.
    const result = await planRenames(["foo.wav", "FOO.wav"], "P-", tmpDir);

    expect(result.skippedCollision).toEqual([]);
    expect(result.operations).toHaveLength(2);
  });

  it("returns operations sorted alphabetically by from", async () => {
    const result = await planRenames(["c.wav", "a.wav", "b.wav"], "P-", tmpDir);

    expect(result.operations.map((op) => op.from)).toEqual([
      "a.wav",
      "b.wav",
      "c.wav",
    ]);
  });

  it("populates all three buckets in a mixed scenario", async () => {
    const prefix = "Car040962-2026-Pass3-A1-";

    // Pre-create the collision target
    await writeFile(path.join(tmpDir, `${prefix}will-collide.wav`), "");

    const files = [
      // Will be in operations
      "clean.wav",
      // Already prefixed → skippedAlreadyPrefixed
      "Car040962-2026-Pass3-A1-existing.wav",
      // External collision → skippedCollision
      "will-collide.wav",
    ];

    const result = await planRenames(files, prefix, tmpDir);

    expect(result.operations).toEqual([
      {
        from: "clean.wav",
        to: `${prefix}clean.wav`,
      },
    ]);
    expect(result.skippedAlreadyPrefixed).toEqual([
      "Car040962-2026-Pass3-A1-existing.wav",
    ]);
    expect(result.skippedCollision).toEqual(["will-collide.wav"]);
  });
});
