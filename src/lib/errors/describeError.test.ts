import { describe, expect, it } from "vitest";
import { describeError } from "./describeError.js";

describe("describeError", () => {
  it("returns the raw code when the error has one", () => {
    const err = Object.assign(new Error("boom"), { code: "ENOSPC" });
    expect(describeError(err)).toBe("ENOSPC");
  });

  it("falls back to the message when the error has no code", () => {
    const err = new Error("something went wrong");
    expect(describeError(err)).toBe("something went wrong");
  });

  it("falls back to 'sans code' when the error has no code and an empty message", () => {
    const err = new Error("");
    expect(describeError(err)).toBe("sans code");
  });

  it("falls back to 'sans code' for a non-Error rejection", () => {
    expect(describeError("some string rejection")).toBe("sans code");
    expect(describeError(null)).toBe("sans code");
    expect(describeError(undefined)).toBe("sans code");
  });
});
