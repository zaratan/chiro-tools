import { describe, expect, it } from "vitest";
import { buildConstatCounts } from "./buildConstatCounts.js";

describe("buildConstatCounts", () => {
  it("returns all-zero counts for an empty listing", () => {
    expect(buildConstatCounts([], 0)).toEqual({
      totalWav: 0,
      alreadyPrefixed: 0,
      whitespacePrefixed: 0,
      upperCaseWav: 0,
      otherIgnored: 0,
    });
  });

  it("counts totalWav as the full listing length", () => {
    const counts = buildConstatCounts(["a.wav", "b.wav", "c.wav"], 0);
    expect(counts.totalWav).toBe(3);
  });

  it("counts already-prefixed files (Vigie-Chiro format)", () => {
    const counts = buildConstatCounts(
      [
        "Car040962-2026-Pass3-A1-recording.wav",
        "PaRecPR1925645_20260507_210004.wav",
      ],
      0,
    );
    expect(counts.alreadyPrefixed).toBe(1);
  });

  it("counts uppercase .WAV files, case-sensitively", () => {
    const counts = buildConstatCounts(
      ["OTHERSTEM.WAV", "lowercase.wav", "Mixed.Wav"],
      0,
    );
    expect(counts.upperCaseWav).toBe(1);
  });

  it("passes ignoredFileCount through as otherIgnored", () => {
    const counts = buildConstatCounts(["a.wav"], 5);
    expect(counts.otherIgnored).toBe(5);
  });

  it("counts an already-prefixed file found inside a Brut/ subfolder", () => {
    const counts = buildConstatCounts(
      [
        "Brut/Car040962-2026-Pass3-A1-old.wav",
        "Brut/PaRecPR1925645_20260507_210004.wav",
      ],
      0,
    );
    expect(counts.alreadyPrefixed).toBe(1);
  });

  it("combines all counters independently on a mixed listing", () => {
    const counts = buildConstatCounts(
      [
        "Car040962-2026-Pass3-A1-old.wav",
        "OTHERSTEM.WAV",
        "PaRecPR1925645_20260507_210004.wav",
      ],
      2,
    );
    expect(counts).toEqual({
      totalWav: 3,
      alreadyPrefixed: 1,
      whitespacePrefixed: 0,
      upperCaseWav: 1,
      otherIgnored: 2,
    });
  });

  it("does not count a prefixed name with a space as already in format, since it still has to be renamed", () => {
    const counts = buildConstatCounts(
      [
        "Car123456-2026-Pass1-Z3-PR01 PR1925645_20260728_205005.wav",
        "Car123456-2026-Pass1-Z3-PR01_PR1925645_20260728_205010.wav",
        "PR01 PR1925645_20260728_205015.wav",
      ],
      0,
    );
    expect(counts.alreadyPrefixed).toBe(1);
    expect(counts.whitespacePrefixed).toBe(1);
  });

  it("does not count a prefixed .WAV file among the extensions to fix, since nothing renames it", () => {
    const counts = buildConstatCounts(
      ["Car040962-2026-Pass3-A1-old.WAV", "RAW.WAV"],
      0,
    );
    expect(counts.upperCaseWav).toBe(1);
  });
});
