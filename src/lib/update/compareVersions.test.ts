import { describe, expect, it } from "vitest";
import { compareVersions } from "./compareVersions.js";
import { parseVersion } from "./parseVersion.js";
import type { ParsedVersion } from "./parseVersion.js";

/** Convenience: parse and assert non-null */
const v = (input: string): ParsedVersion => {
  const parsed = parseVersion(input);
  if (parsed === null) throw new Error(`Bad version in test fixture: ${input}`);
  return parsed;
};

describe("compareVersions — major/minor/patch ordering", () => {
  it("returns -1 when major is smaller (0.1.0 < 1.0.0)", () => {
    expect(compareVersions(v("0.1.0"), v("1.0.0"))).toBe(-1);
  });

  it("returns 1 when major is larger (1.0.0 > 0.1.0)", () => {
    expect(compareVersions(v("1.0.0"), v("0.1.0"))).toBe(1);
  });

  it("returns -1 when minor is smaller at equal major (0.1.0 < 0.2.0)", () => {
    expect(compareVersions(v("0.1.0"), v("0.2.0"))).toBe(-1);
  });

  it("returns 1 when patch is larger (0.1.0 > 0.0.9)", () => {
    expect(compareVersions(v("0.1.0"), v("0.0.9"))).toBe(1);
  });

  it("returns 0 for equal stable versions (0.1.0 === 0.1.0)", () => {
    expect(compareVersions(v("0.1.0"), v("0.1.0"))).toBe(0);
  });

  it("returns 1 when minor is larger at equal major (0.2.0 > 0.1.0)", () => {
    expect(compareVersions(v("0.2.0"), v("0.1.0"))).toBe(1);
  });

  it("returns -1 when patch is smaller at equal major/minor (0.1.0 < 0.1.1)", () => {
    expect(compareVersions(v("0.1.0"), v("0.1.1"))).toBe(-1);
  });

  it("returns 1 when patch is larger at equal major/minor (0.1.5 > 0.1.3)", () => {
    expect(compareVersions(v("0.1.5"), v("0.1.3"))).toBe(1);
  });
});

describe("compareVersions — pre-release vs stable (semver §11.3)", () => {
  it("pre-release < release at equal M.m.p (0.1.0-rc.1 < 0.1.0)", () => {
    expect(compareVersions(v("0.1.0-rc.1"), v("0.1.0"))).toBe(-1);
  });

  it("release > pre-release at equal M.m.p (0.1.0 > 0.1.0-rc.1)", () => {
    expect(compareVersions(v("0.1.0"), v("0.1.0-rc.1"))).toBe(1);
  });
});

describe("compareVersions — pre-release identifier ordering (semver §11.4)", () => {
  it("compares numeric identifiers numerically: rc.2 < rc.10", () => {
    expect(compareVersions(v("0.1.0-rc.2"), v("0.1.0-rc.10"))).toBe(-1);
  });

  it("numeric identifier < non-numeric at same position: 0.1.0-1 < 0.1.0-rc.1", () => {
    // semver §11.4.3: non-numeric > numeric
    expect(compareVersions(v("0.1.0-1"), v("0.1.0-rc.1"))).toBe(-1);
  });

  it("non-numeric > numeric (0.1.0-rc.1 > 0.1.0-1)", () => {
    expect(compareVersions(v("0.1.0-rc.1"), v("0.1.0-1"))).toBe(1);
  });

  it("non-numeric identifiers are compared lexicographically: alpha < rc", () => {
    expect(compareVersions(v("0.1.0-alpha"), v("0.1.0-rc"))).toBe(-1);
  });

  it("longer pre-release has precedence when prefix is equal: alpha < alpha.1", () => {
    expect(compareVersions(v("0.1.0-alpha"), v("0.1.0-alpha.1"))).toBe(-1);
  });

  it("returns 1 when a is longer than b at equal prefix: alpha.1 > alpha", () => {
    expect(compareVersions(v("0.1.0-alpha.1"), v("0.1.0-alpha"))).toBe(1);
  });

  it("shorter pre-release < longer when all shared identifiers are equal", () => {
    expect(compareVersions(v("0.1.0-alpha.1"), v("0.1.0-alpha.1.1"))).toBe(-1);
  });

  it("returns 1 when lex comparison favors a (rc > alpha)", () => {
    expect(compareVersions(v("0.1.0-rc"), v("0.1.0-alpha"))).toBe(1);
  });

  it("returns 0 for equal pre-release versions (0.1.0-rc.1 === 0.1.0-rc.1)", () => {
    expect(compareVersions(v("0.1.0-rc.1"), v("0.1.0-rc.1"))).toBe(0);
  });
});
