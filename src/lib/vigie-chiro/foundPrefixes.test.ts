import { describe, expect, it } from "vitest";
import type { RenamePlan } from "../../types.js";
import {
  filesWithOtherPrefix,
  oneOfEachPrefixFirst,
  summarizeFoundPrefixes,
} from "./foundPrefixes.js";

const pass1 = "Car123456-2026-Pass1-A1-";
const pass2 = "Car123456-2026-Pass2-A1-";

const plan = (overrides: Partial<RenamePlan>): RenamePlan => ({
  operations: [],
  skippedAlreadyPrefixed: [],
  skippedCollision: [],
  ...overrides,
});

describe("filesWithOtherPrefix", () => {
  it("lists the files whose prefix will be replaced", () => {
    expect(
      filesWithOtherPrefix(
        plan({
          operations: [
            { from: `${pass1}a.wav`, to: `${pass2}a.wav`, kind: "reprefix" },
            { from: "raw.wav", to: `${pass2}raw.wav`, kind: "prefix" },
          ],
        }),
        pass2,
      ),
    ).toEqual([`${pass1}a.wav`]);
  });

  it("keeps a file with another prefix that ended in collision, so the group does not hide it", () => {
    expect(
      filesWithOtherPrefix(
        plan({
          skippedCollision: [`${pass1}a.wav`, "raw.wav", `${pass2}b c.wav`],
        }),
        pass2,
      ),
    ).toEqual([`${pass1}a.wav`]);
  });
});

describe("summarizeFoundPrefixes", () => {
  it("returns each prefix once, sorted, with the true count", () => {
    expect(
      summarizeFoundPrefixes(
        [`${pass2}a.wav`, "raw.wav", `${pass1}b.wav`, `Brut/${pass1}c.wav`],
        20,
      ),
    ).toEqual({ prefixes: [pass1, pass2], count: 2 });
  });

  it("cuts the list at the limit but keeps counting", () => {
    const files = ["A1", "A2", "A3"].map(
      (point) => `Car123456-2026-Pass1-${point}-x.wav`,
    );

    expect(summarizeFoundPrefixes(files, 2)).toEqual({
      prefixes: ["Car123456-2026-Pass1-A1-", "Car123456-2026-Pass1-A2-"],
      count: 3,
    });
  });

  it("finds nothing among raw recordings", () => {
    expect(summarizeFoundPrefixes(["raw.wav"], 20)).toEqual({
      prefixes: [],
      count: 0,
    });
  });
});

describe("oneOfEachPrefixFirst", () => {
  it("puts one file of each prefix first, so the examples show every prefix found", () => {
    const pass3 = "Car123456-2026-Pass3-A1-";
    const items = [
      `${pass1}a.wav`,
      `${pass1}b.wav`,
      `${pass3}c.wav`,
      `${pass3}d.wav`,
    ].map((from) => ({ from }));

    expect(oneOfEachPrefixFirst(items).map((item) => item.from)).toEqual([
      `${pass1}a.wav`,
      `${pass3}c.wav`,
      `${pass1}b.wav`,
      `${pass3}d.wav`,
    ]);
  });

  it("keeps the order when there is a single prefix", () => {
    const items = [`${pass1}a.wav`, `${pass1}b.wav`].map((from) => ({ from }));

    expect(oneOfEachPrefixFirst(items)).toEqual(items);
  });
});
