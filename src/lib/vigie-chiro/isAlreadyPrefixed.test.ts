import { describe, expect, it } from "vitest";
import { isAlreadyPrefixed } from "./isAlreadyPrefixed.js";

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
});
