import { describe, expect, it } from "vitest";
import { columnWidth, fitPath } from "../path.js";

describe("columnWidth", () => {
  it("counts an NFD accented character as one column", () => {
    // macOS stores filenames decomposed: "é" arrives as e + U+0301.
    const nfd = "e\u0301";
    expect(nfd.length).toBe(2);
    expect(columnWidth(nfd)).toBe(1);
  });
});

describe("fitPath", () => {
  it("leaves a path that already fits untouched", () => {
    expect(fitPath("/tmp/chiro-demo", 63)).toBe("/tmp/chiro-demo");
  });

  it("keeps the tail, which is what identifies the folder", () => {
    const real =
      "/Users/marie-christine/Documents/Vigie-Chiro/Saison 2026/Carre 340581/Point A1";
    const fitted = fitPath(real, 63);
    expect(columnWidth(fitted)).toBe(63);
    expect(fitted.endsWith("Carre 340581/Point A1")).toBe(true);
    expect(fitted.startsWith("…")).toBe(true);
  });

  it("does not over-trim a decomposed accented path", () => {
    const accented = `/Users/noe\u0301mie/${"e\u0301".repeat(80)}`;
    expect(columnWidth(fitPath(accented, 63))).toBe(63);
  });

  it("never exceeds the budget at the exact boundary", () => {
    for (const len of [62, 63, 64, 65]) {
      expect(columnWidth(fitPath("/".repeat(len), 63))).toBeLessThanOrEqual(63);
    }
  });
});
