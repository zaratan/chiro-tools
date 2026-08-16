import { describe, expect, it } from "vitest";
import { extractCommonPrefix } from "./extractCommonPrefix.js";

describe("extractCommonPrefix", () => {
  it("returns the shared prefix when every name has the same one", () => {
    expect(
      extractCommonPrefix([
        "Car340581-2026-Pass1-A1-a_001.wav",
        "Car340581-2026-Pass1-A1-b_002.wav",
      ]),
    ).toBe("Car340581-2026-Pass1-A1");
  });

  it("returns null when prefixes differ", () => {
    expect(
      extractCommonPrefix([
        "Car340581-2026-Pass1-A1-a_001.wav",
        "Car340581-2026-Pass2-A1-b_002.wav",
      ]),
    ).toBeNull();
  });

  it("returns null when no name matches the prefix pattern at all", () => {
    expect(
      extractCommonPrefix([
        "PaRecPR1925645_20260507_210004.wav",
        "PaRecPR1925645_20260507_210104.wav",
      ]),
    ).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(extractCommonPrefix([])).toBeNull();
  });

  it("returns the prefix for a single file", () => {
    expect(extractCommonPrefix(["Car340581-2026-Pass1-A1-a_001.wav"])).toBe(
      "Car340581-2026-Pass1-A1",
    );
  });

  it("is case-sensitive: lowercase 'car' does not match", () => {
    expect(
      extractCommonPrefix(["car340581-2026-Pass1-A1-a_001.wav"]),
    ).toBeNull();
  });

  it("captures a multi-character point code", () => {
    expect(extractCommonPrefix(["Car340581-2026-Pass1-ETANG-a_001.wav"])).toBe(
      "Car340581-2026-Pass1-ETANG",
    );
  });

  it("captures a mixed letter+digit point code longer than one letter+digit", () => {
    expect(extractCommonPrefix(["Car340581-2026-Pass1-A12-a_001.wav"])).toBe(
      "Car340581-2026-Pass1-A12",
    );
  });
});

describe("extractCommonPrefix — mixed batches", () => {
  it("returns null when only some files carry the prefix", () => {
    // The production case that matters: one foreign file dropped into
    // `processed/`. Without this, the deposit folder gets named after the
    // prefixed subset instead of falling back to `depot_YYYYMMDD` — a name
    // that claims the batch is one study when it is not.
    expect(
      extractCommonPrefix([
        "Car340581-2026-Pass1-A1-a_001.wav",
        "Car340581-2026-Pass1-A1-a_002.wav",
        "notes-de-terrain.wav",
      ]),
    ).toBeNull();
  });
});
