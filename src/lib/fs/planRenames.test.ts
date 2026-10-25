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
        kind: "prefix",
      },
      {
        from: "PaRecPR123_20260507_210009.wav",
        to: "Car040962-2026-Pass3-A1-PaRecPR123_20260507_210009.wav",
        kind: "prefix",
      },
      {
        from: "PaRecPR123_20260507_210011.wav",
        to: "Car040962-2026-Pass3-A1-PaRecPR123_20260507_210011.wav",
        kind: "prefix",
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
        kind: "prefix",
      },
    ]);
    expect(result.skippedCollision).toEqual([]);
  });

  it("normalizes .WAV extension to .wav in the target name", async () => {
    const result = await planRenames(["FOO.WAV"], "P-", tmpDir);

    expect(result.operations).toEqual([
      { from: "FOO.WAV", to: "P-FOO.wav", kind: "prefix" },
    ]);
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

    expect(result.operations).toEqual([
      { from: "foo.WAV", to: "P-foo.wav", kind: "prefix" },
    ]);
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
        kind: "prefix",
      },
    ]);
    expect(result.skippedAlreadyPrefixed).toEqual([
      "Car040962-2026-Pass3-A1-existing.wav",
    ]);
    expect(result.skippedCollision).toEqual(["will-collide.wav"]);
  });

  describe("Brut/ subfolder entries", () => {
    it("keeps the subfolder in the target name — renamed on place, never moved to the root", async () => {
      const prefix = "Car040962-2026-Pass3-A1-";

      const result = await planRenames(["Brut/rec.wav"], prefix, tmpDir);

      expect(result.operations).toEqual([
        {
          from: "Brut/rec.wav",
          to: "Brut/Car040962-2026-Pass3-A1-rec.wav",
          kind: "prefix",
        },
      ]);
    });

    it("does not collide a root file with a same-named file in Brut/ — different paths, not a real collision", async () => {
      const result = await planRenames(
        ["rec.wav", "Brut/rec.wav"],
        "P-",
        tmpDir,
      );

      expect(result.skippedCollision).toEqual([]);
      expect(result.operations).toEqual([
        { from: "Brut/rec.wav", to: "Brut/P-rec.wav", kind: "prefix" },
        { from: "rec.wav", to: "P-rec.wav", kind: "prefix" },
      ]);
    });

    it("skips an already-prefixed file inside Brut/ (idempotence across subfolders)", async () => {
      const result = await planRenames(
        ["Brut/Car040962-2026-Pass3-A1-old.wav"],
        "Car040962-2026-Pass3-A1-",
        tmpDir,
      );

      expect(result.operations).toEqual([]);
      expect(result.skippedAlreadyPrefixed).toEqual([
        "Brut/Car040962-2026-Pass3-A1-old.wav",
      ]);
    });
  });

  describe("whitespace in names", () => {
    const teensyPrefixed =
      "Car123456-2026-Pass1-Z3-PR01 PR1925645_20260728_205005.wav";

    it("replaces the space of a raw Teensy name in its prefixed target", async () => {
      const result = await planRenames(
        ["PR01 PR1925645_20260728_205005.wav"],
        "Car040962-2026-Pass3-A1-",
        tmpDir,
      );

      expect(result.operations).toEqual([
        {
          from: "PR01 PR1925645_20260728_205005.wav",
          to: "Car040962-2026-Pass3-A1-PR01_PR1925645_20260728_205005.wav",
          kind: "prefix",
        },
      ]);
    });

    it("renames an already-prefixed name with a space, keeping its own prefix whatever the form says", async () => {
      const result = await planRenames(
        [teensyPrefixed],
        "Car040962-2026-Pass2-A1-",
        tmpDir,
      );

      expect(result.skippedAlreadyPrefixed).toEqual([]);
      expect(result.operations).toEqual([
        {
          from: teensyPrefixed,
          to: "Car123456-2026-Pass1-Z3-PR01_PR1925645_20260728_205005.wav",
          kind: "whitespace",
        },
      ]);
    });

    it("still skips an already-prefixed name without whitespace", async () => {
      const clean =
        "Car123456-2026-Pass1-Z3-PR01_PR1925645_20260728_205005.wav";

      const result = await planRenames(
        [clean],
        "Car123456-2026-Pass1-Z3-",
        tmpDir,
      );

      expect(result.operations).toEqual([]);
      expect(result.skippedAlreadyPrefixed).toEqual([clean]);
    });

    it("keeps one operation and one collision when a raw copy and its prefixed twin aim at the same name", async () => {
      const result = await planRenames(
        ["PR01 PR1925645_20260728_205005.wav", teensyPrefixed],
        "Car123456-2026-Pass1-Z3-",
        tmpDir,
      );

      expect(result.operations).toEqual([
        {
          from: teensyPrefixed,
          to: "Car123456-2026-Pass1-Z3-PR01_PR1925645_20260728_205005.wav",
          kind: "whitespace",
        },
      ]);
      expect(result.skippedCollision).toEqual([
        "PR01 PR1925645_20260728_205005.wav",
      ]);
    });

    it("keeps one operation and one collision when the raw copy sorts before its prefixed twin", async () => {
      const result = await planRenames(
        [
          "AB01 PR1925645_20260728_205005.wav",
          "Car123456-2026-Pass1-Z3-AB01 PR1925645_20260728_205005.wav",
        ],
        "Car123456-2026-Pass1-Z3-",
        tmpDir,
      );

      expect(result.operations).toHaveLength(1);
      expect(result.skippedCollision).toHaveLength(1);
    });

    it("puts a prefixed name with a space in collision when its fixed name already exists on disk", async () => {
      await writeFile(
        path.join(
          tmpDir,
          "Car123456-2026-Pass1-Z3-PR01_PR1925645_20260728_205005.wav",
        ),
        "",
      );

      const result = await planRenames(
        [teensyPrefixed],
        "Car123456-2026-Pass1-Z3-",
        tmpDir,
      );

      expect(result.operations).toEqual([]);
      expect(result.skippedCollision).toEqual([teensyPrefixed]);
    });

    it("fixes the space of a prefixed name inside Brut/ without touching the folder", async () => {
      const result = await planRenames(
        [`Brut/${teensyPrefixed}`],
        "Car123456-2026-Pass1-Z3-",
        tmpDir,
      );

      expect(result.operations).toEqual([
        {
          from: `Brut/${teensyPrefixed}`,
          to: "Brut/Car123456-2026-Pass1-Z3-PR01_PR1925645_20260728_205005.wav",
          kind: "whitespace",
        },
      ]);
    });
  });
});
