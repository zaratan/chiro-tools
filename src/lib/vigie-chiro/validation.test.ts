import { describe, expect, it } from "vitest";
import {
  validatePassNumber,
  validatePointCode,
  validateSquareCode,
  validateYear,
} from "./validation.js";

describe("validateSquareCode", () => {
  it("accepts a valid 6-digit square code", () => {
    expect(validateSquareCode("040962")).toBeNull();
  });

  it("accepts a square code starting with 1 (dept 12+)", () => {
    expect(validateSquareCode("123456")).toBeNull();
  });

  it("rejects a 5-digit code and reports the typed length", () => {
    const result = validateSquareCode("12345");
    expect(result).not.toBeNull();
    expect(result).toContain("5");
  });

  it("rejects a 7-digit code and reports the typed length", () => {
    const result = validateSquareCode("1234567");
    expect(result).not.toBeNull();
    expect(result).toContain("7");
  });

  it("rejects a code containing a letter", () => {
    const result = validateSquareCode("12345a");
    expect(result).not.toBeNull();
    expect(result).toContain("chiffres");
  });

  it("rejects an empty string (0 digits)", () => {
    const result = validateSquareCode("");
    expect(result).not.toBeNull();
    expect(result).toContain("0");
  });

  it("rejects a string of spaces (spaces are not digits)", () => {
    const result = validateSquareCode("      ");
    expect(result).not.toBeNull();
    expect(result).toContain("chiffres");
  });
});

describe("validateYear", () => {
  it("accepts 2026", () => {
    expect(validateYear("2026")).toBeNull();
  });

  it("accepts the lower bound 1900", () => {
    expect(validateYear("1900")).toBeNull();
  });

  it("accepts the upper bound 2100", () => {
    expect(validateYear("2100")).toBeNull();
  });

  it("rejects 1899 (out of range)", () => {
    const result = validateYear("1899");
    expect(result).not.toBeNull();
    expect(result).toContain("1900");
    expect(result).toContain("2100");
  });

  it("rejects 2101 (out of range)", () => {
    const result = validateYear("2101");
    expect(result).not.toBeNull();
    expect(result).toContain("1900");
    expect(result).toContain("2100");
  });

  it("rejects '26' (not 4 digits)", () => {
    const result = validateYear("26");
    expect(result).not.toBeNull();
    expect(result).toContain("4 chiffres");
  });

  it("rejects '20260' (not 4 digits)", () => {
    const result = validateYear("20260");
    expect(result).not.toBeNull();
    expect(result).toContain("4 chiffres");
  });

  it("rejects 'abcd' (not digits)", () => {
    const result = validateYear("abcd");
    expect(result).not.toBeNull();
    expect(result).toContain("4 chiffres");
  });

  it("rejects an empty string", () => {
    const result = validateYear("");
    expect(result).not.toBeNull();
    expect(result).toContain("4 chiffres");
  });
});

describe("validatePassNumber", () => {
  it("accepts 1", () => {
    expect(validatePassNumber("1")).toBeNull();
  });

  it("accepts 99", () => {
    expect(validatePassNumber("99")).toBeNull();
  });

  it("accepts 100", () => {
    expect(validatePassNumber("100")).toBeNull();
  });

  it("rejects 0", () => {
    expect(validatePassNumber("0")).not.toBeNull();
  });

  it("rejects -1", () => {
    expect(validatePassNumber("-1")).not.toBeNull();
  });

  it("rejects 1.5 (decimal)", () => {
    expect(validatePassNumber("1.5")).not.toBeNull();
  });

  it("rejects 'abc'", () => {
    expect(validatePassNumber("abc")).not.toBeNull();
  });

  it("rejects an empty string", () => {
    expect(validatePassNumber("")).not.toBeNull();
  });
});

describe("validatePointCode", () => {
  it("accepts A1", () => {
    expect(validatePointCode("A1")).toBeNull();
  });

  it("accepts Z9", () => {
    expect(validatePointCode("Z9")).toBeNull();
  });

  it("accepts a1 lowercase (normalization happens elsewhere)", () => {
    expect(validatePointCode("a1")).toBeNull();
  });

  it("rejects AA (two letters)", () => {
    expect(validatePointCode("AA")).not.toBeNull();
  });

  it("rejects 1A (digit first)", () => {
    expect(validatePointCode("1A")).not.toBeNull();
  });

  it("rejects A12 (two digits)", () => {
    expect(validatePointCode("A12")).not.toBeNull();
  });

  it("rejects an empty string", () => {
    expect(validatePointCode("")).not.toBeNull();
  });

  it("rejects 'A' alone (no digit)", () => {
    expect(validatePointCode("A")).not.toBeNull();
  });
});
