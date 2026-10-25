import { describe, expect, it } from "vitest";
import {
  countRecordingsWithWhitespace,
  findWhitespaceNamesBlockedByPrefixed,
  hasWhitespaceInBaseName,
  isAlreadyCompliant,
  replaceWhitespaceInBaseName,
} from "./whitespaceInName.js";

describe("replaceWhitespaceInBaseName", () => {
  it("replaces the Teensy padding space so Vigie-Chiro accepts the name", () => {
    expect(
      replaceWhitespaceInBaseName("PR01 PR1925645_20260728_205005.wav"),
    ).toBe("PR01_PR1925645_20260728_205005.wav");
  });

  it("replaces each whitespace character with its own underscore so two names never merge", () => {
    expect(replaceWhitespaceInBaseName("a  b.wav")).toBe("a__b.wav");
  });

  it("covers tab, no-break space and narrow no-break space, invisible to the user", () => {
    expect(
      replaceWhitespaceInBaseName(
        `a\tb${String.fromCharCode(0xa0)}c${String.fromCharCode(0x202f)}d.wav`,
      ),
    ).toBe("a_b_c_d.wav");
  });

  it("never touches the folder part of a Brut/ entry", () => {
    expect(replaceWhitespaceInBaseName("Mon Brut/x y.wav")).toBe(
      "Mon Brut/x_y.wav",
    );
  });

  it("keeps the extension case, since only whitespace changes", () => {
    expect(
      replaceWhitespaceInBaseName("Car123456-2026-Pass1-Z3-PR01 PR1.WAV"),
    ).toBe("Car123456-2026-Pass1-Z3-PR01_PR1.WAV");
  });

  it("returns the very same path when there is nothing to replace", () => {
    expect(replaceWhitespaceInBaseName("Brut/clean.wav")).toBe(
      "Brut/clean.wav",
    );
  });
});

describe("hasWhitespaceInBaseName", () => {
  it("gives the same answer on repeated calls despite the shared global regex", () => {
    const answers = [1, 2, 3].map(() => hasWhitespaceInBaseName("a b.wav"));
    expect(answers).toEqual([true, true, true]);
  });

  it("ignores whitespace in the folder name", () => {
    expect(hasWhitespaceInBaseName("Mon Brut/clean.wav")).toBe(false);
  });
});

describe("isAlreadyCompliant", () => {
  it("accepts a prefixed name without whitespace", () => {
    expect(isAlreadyCompliant("Car123456-2026-Pass1-Z3-PR01_PR1.wav")).toBe(
      true,
    );
  });

  it("rejects a prefixed name that still holds a space", () => {
    expect(isAlreadyCompliant("Car123456-2026-Pass1-Z3-PR01 PR1.wav")).toBe(
      false,
    );
  });

  it("rejects a raw name", () => {
    expect(isAlreadyCompliant("PR01_PR1.wav")).toBe(false);
  });
});

describe("countRecordingsWithWhitespace", () => {
  it("counts only recordings, so a note dropped in processed/ does not block the upload", () => {
    expect(
      countRecordingsWithWhitespace([
        "Car123456-2026-Pass1-Z3-PR01 PR1_000.wav",
        "Car123456-2026-Pass1-Z3-PR01 PR1_001.WAV",
        "Car123456-2026-Pass1-Z3-PR01_PR2_000.wav",
        "notes terrain.txt",
      ]),
    ).toBe(2);
  });
});

describe("findWhitespaceNamesBlockedByPrefixed", () => {
  const raw = "PR01 PR1925645_20260728_205005.wav";

  it("flags a raw copy whose prefixed twin still holds the space, since prefixing would leave it in collision", () => {
    expect(
      findWhitespaceNamesBlockedByPrefixed([
        raw,
        `Car123456-2026-Pass1-Z3-${raw}`,
      ]),
    ).toEqual([raw]);
  });

  it("flags a raw copy whose prefixed twin was already fixed", () => {
    expect(
      findWhitespaceNamesBlockedByPrefixed([
        raw,
        "Car123456-2026-Pass1-Z3-PR01_PR1925645_20260728_205005.wav",
      ]),
    ).toEqual([raw]);
  });

  it("matches the twin whatever the case of the raw extension", () => {
    expect(
      findWhitespaceNamesBlockedByPrefixed([
        "PR01 PR1925645_20260728_205005.WAV",
        "Car123456-2026-Pass1-Z3-PR01_PR1925645_20260728_205005.wav",
      ]),
    ).toEqual(["PR01 PR1925645_20260728_205005.WAV"]);
  });

  it("leaves a raw name with a space alone when nothing prefixed shares its name, since prefixing will fix it", () => {
    expect(
      findWhitespaceNamesBlockedByPrefixed([
        raw,
        "Car123456-2026-Pass1-Z3-PR01_PR1925645_20260728_205010.wav",
      ]),
    ).toEqual([]);
  });

  it("does not pair files from different folders, since each is renamed in its own folder", () => {
    expect(
      findWhitespaceNamesBlockedByPrefixed([
        `Brut/${raw}`,
        `Car123456-2026-Pass1-Z3-${raw}`,
      ]),
    ).toEqual([]);
  });

  it("does not flag a raw name without space next to its prefixed twin, since the split accepts it", () => {
    expect(
      findWhitespaceNamesBlockedByPrefixed([
        "PR01_PR1925645_20260728_205005.wav",
        "Car123456-2026-Pass1-Z3-PR01_PR1925645_20260728_205005.wav",
      ]),
    ).toEqual([]);
  });

  it("flags only the prefixed name left with a space when its fixed twin exists, so the good copy is never named", () => {
    expect(
      findWhitespaceNamesBlockedByPrefixed([
        "Car123456-2026-Pass1-Z3-AB01 X.wav",
        "Car123456-2026-Pass1-Z3-AB01_X.wav",
      ]),
    ).toEqual(["Car123456-2026-Pass1-Z3-AB01 X.wav"]);
  });
});
