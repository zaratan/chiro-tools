import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ArchiveEntryStat } from "../../../lib/archive/planArchive.js";
import {
  createPackageBehavior,
  type CreateZipVolumesFn,
} from "../packageBehavior.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-test-package-behavior-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const unusedWriter: CreateZipVolumesFn = () => {
  throw new Error("createZipVolumes should not run in this test");
};

const entry = (name: string): ArchiveEntryStat => ({
  name,
  size: 4,
  mtime: new Date("2026-10-25T00:00:00Z"),
});

const seriesNameFor = async (names: readonly string[]): Promise<string> => {
  const behavior = createPackageBehavior(
    path.join(tmpDir, "processed"),
    path.join(tmpDir, "upload"),
    names.map(entry),
    unusedWriter,
  );
  return (await behavior.resolveTargetName()).name;
};

describe("createPackageBehavior — series name", () => {
  it("names the series after the recordings' Vigie-Chiro prefix", async () => {
    expect(
      await seriesNameFor(["Car340581-2026-Pass1-A1-PaRec_x_000.wav"]),
    ).toMatch(/^Car340581-2026-Pass1-A1_\d{8}$/);
  });

  it("keeps the series name when a .txt note sits in processed/, since only recordings carry the prefix", async () => {
    expect(
      await seriesNameFor([
        "Car340581-2026-Pass1-A1-PaRec_x_000.wav",
        "notes terrain.txt",
      ]),
    ).toMatch(/^Car340581-2026-Pass1-A1_\d{8}$/);
  });

  it("falls back to a local depot_ name without a common prefix", async () => {
    expect(await seriesNameFor(["PaRec_x_000.wav"])).toMatch(/^depot_\d{8}$/);
  });
});
