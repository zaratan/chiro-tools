import { describe, expect, it } from "vitest";
import { parseVersion } from "./parseVersion.js";

describe("parseVersion — valid inputs", () => {
  it("parses v0.1.0", () => {
    expect(parseVersion("v0.1.0")).toEqual({
      major: 0,
      minor: 1,
      patch: 0,
      prerelease: null,
    });
  });

  it("parses 0.1.0 (no v prefix)", () => {
    expect(parseVersion("0.1.0")).toEqual({
      major: 0,
      minor: 1,
      patch: 0,
      prerelease: null,
    });
  });

  it("parses v0.1.0-rc.1", () => {
    expect(parseVersion("v0.1.0-rc.1")).toEqual({
      major: 0,
      minor: 1,
      patch: 0,
      prerelease: ["rc", "1"],
    });
  });

  it("parses 0.1.0-alpha.10", () => {
    expect(parseVersion("0.1.0-alpha.10")).toEqual({
      major: 0,
      minor: 1,
      patch: 0,
      prerelease: ["alpha", "10"],
    });
  });

  it("parses 0.1.0+ci.42 (build metadata discarded)", () => {
    expect(parseVersion("0.1.0+ci.42")).toEqual({
      major: 0,
      minor: 1,
      patch: 0,
      prerelease: null,
    });
  });

  it("parses 0.1.0-rc.1+ci.42 (prerelease kept, build metadata discarded)", () => {
    expect(parseVersion("0.1.0-rc.1+ci.42")).toEqual({
      major: 0,
      minor: 1,
      patch: 0,
      prerelease: ["rc", "1"],
    });
  });

  it("parses 1.2.3", () => {
    expect(parseVersion("1.2.3")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: null,
    });
  });

  it("parses 10.20.30 (multi-digit components)", () => {
    expect(parseVersion("10.20.30")).toEqual({
      major: 10,
      minor: 20,
      patch: 30,
      prerelease: null,
    });
  });
});

describe("parseVersion — invalid inputs return null", () => {
  it("rejects v01.2.3 (leading zero on major)", () => {
    expect(parseVersion("v01.2.3")).toBeNull();
  });

  it("rejects 0.01.0 (leading zero on minor)", () => {
    expect(parseVersion("0.01.0")).toBeNull();
  });

  it("rejects 0.0.01 (leading zero on patch)", () => {
    expect(parseVersion("0.0.01")).toBeNull();
  });

  it("rejects 1.2 (missing patch)", () => {
    expect(parseVersion("1.2")).toBeNull();
  });

  it("rejects 1.2.3.4 (extra component)", () => {
    expect(parseVersion("1.2.3.4")).toBeNull();
  });

  it("rejects not-a-version", () => {
    expect(parseVersion("not-a-version")).toBeNull();
  });

  it("rejects empty string", () => {
    expect(parseVersion("")).toBeNull();
  });

  it("rejects v0.1.0- (empty prerelease)", () => {
    expect(parseVersion("v0.1.0-")).toBeNull();
  });

  it("rejects v0.1.0-rc..1 (empty prerelease part)", () => {
    expect(parseVersion("v0.1.0-rc..1")).toBeNull();
  });

  it("rejects v0.1.0-+meta (empty prerelease before build metadata)", () => {
    expect(parseVersion("v0.1.0-+meta")).toBeNull();
  });
});
