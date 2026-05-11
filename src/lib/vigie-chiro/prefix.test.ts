import { describe, expect, it } from "vitest";
import { buildPrefix } from "./prefix.js";

describe("buildPrefix", () => {
  it("generates the nominal prefix", () => {
    expect(
      buildPrefix({
        squareCode: "040962",
        year: 2026,
        passNumber: 3,
        pointCode: "A1",
      }),
    ).toBe("Car040962-2026-Pass3-A1-");
  });

  it("preserves the leading zero for departments 1-9 (squareCode '010001')", () => {
    const prefix = buildPrefix({
      squareCode: "010001",
      year: 2026,
      passNumber: 3,
      pointCode: "A1",
    });
    expect(prefix).toContain("Car010001-");
  });

  it("normalizes the point code to uppercase", () => {
    const prefix = buildPrefix({
      squareCode: "040962",
      year: 2026,
      passNumber: 3,
      pointCode: "a1",
    });
    expect(prefix).toContain("A1");
    expect(prefix).not.toContain("a1");
  });

  it("handles a 3-digit pass number (100)", () => {
    const prefix = buildPrefix({
      squareCode: "040962",
      year: 2026,
      passNumber: 100,
      pointCode: "A1",
    });
    expect(prefix).toContain("Pass100");
  });

  it("includes the year 1900 correctly", () => {
    const prefix = buildPrefix({
      squareCode: "040962",
      year: 1900,
      passNumber: 1,
      pointCode: "A1",
    });
    expect(prefix).toContain("1900");
  });
});
