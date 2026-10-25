import { describe, expect, it } from "vitest";
import { extractVigiePrefix, isAlreadyPrefixed } from "./isAlreadyPrefixed.js";

describe("isAlreadyPrefixed", () => {
  it("recognizes a prefixed file (single-digit pass)", () => {
    expect(isAlreadyPrefixed("Car040962-2026-Pass3-A1-old.wav")).toBe(true);
  });

  it("recognizes a prefixed file (3-digit pass, point Z9)", () => {
    expect(isAlreadyPrefixed("Car040962-2026-Pass100-Z9-foo.wav")).toBe(true);
  });

  it("rejects a raw Teensy recorder filename", () => {
    expect(isAlreadyPrefixed("PaRecPR1925645_20260507_210004.wav")).toBe(false);
  });

  it("rejects a filename with lowercase 'car' prefix", () => {
    expect(isAlreadyPrefixed("car040962-2026-Pass3-A1-old.wav")).toBe(false);
  });

  it("rejects a filename with only 5 digits in the square code", () => {
    expect(isAlreadyPrefixed("Car04096-2026-Pass3-A1-old.wav")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isAlreadyPrefixed("")).toBe(false);
  });

  it("rejects a random filename", () => {
    expect(isAlreadyPrefixed("random.wav")).toBe(false);
  });

  it("recognizes a prefixed file inside a Brut/ subfolder (relative-path input)", () => {
    expect(isAlreadyPrefixed("Brut/Car040962-2026-Pass3-A1-old.wav")).toBe(
      true,
    );
  });

  it("rejects a raw file inside a Brut/ subfolder", () => {
    expect(isAlreadyPrefixed("Brut/PaRecPR1925645_20260507_210004.wav")).toBe(
      false,
    );
  });
});

describe("extractVigiePrefix", () => {
  it("returns the prefix with its trailing dash, in the shape buildPrefix produces", () => {
    expect(extractVigiePrefix("Car040962-2026-Pass3-A1-PaRec_210004.wav")).toBe(
      "Car040962-2026-Pass3-A1-",
    );
  });

  it("returns null for a raw recording", () => {
    expect(extractVigiePrefix("PaRecPR1925645_20260507_210004.wav")).toBeNull();
  });

  it("reads the prefix of a file inside Brut/ from its base name", () => {
    expect(extractVigiePrefix("Brut/Car040962-2026-Pass3-A1-old.wav")).toBe(
      "Car040962-2026-Pass3-A1-",
    );
  });

  it("keeps the case of the point, so that a1 and A1 stay two prefixes", () => {
    expect(extractVigiePrefix("Car040962-2026-Pass3-a1-old.wav")).toBe(
      "Car040962-2026-Pass3-a1-",
    );
  });

  it("returns null for a lowercase car, which the idempotence check refuses too", () => {
    expect(extractVigiePrefix("car040962-2026-Pass3-A1-old.wav")).toBeNull();
  });

  it("returns only the first prefix of a name prefixed twice", () => {
    expect(
      extractVigiePrefix(
        "Car040962-2026-Pass3-A1-Car040962-2026-Pass1-A1-old.wav",
      ),
    ).toBe("Car040962-2026-Pass3-A1-");
  });
});
