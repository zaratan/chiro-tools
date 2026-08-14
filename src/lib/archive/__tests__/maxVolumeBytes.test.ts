import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_MAX_VOLUME_BYTES, maxVolumeBytes } from "../maxVolumeBytes.js";
import { MAX_UINT32 } from "../zipFormat.js";

const ENV_VAR = "CHIRO_MAX_VOLUME_BYTES";
const MIN_VOLUME_BYTES = 1024 * 1024;

afterEach(() => {
  delete process.env.CHIRO_MAX_VOLUME_BYTES;
});

describe("maxVolumeBytes", () => {
  it("returns the default when unset", () => {
    expect(maxVolumeBytes()).toBe(DEFAULT_MAX_VOLUME_BYTES);
  });

  it.each([
    ["abc", "non-numeric"],
    ["", "empty string"],
    ["-1", "negative"],
    ["0", "zero"],
  ])("returns the default for %s (%s)", (value) => {
    process.env[ENV_VAR] = value;
    expect(maxVolumeBytes()).toBe(DEFAULT_MAX_VOLUME_BYTES);
  });

  it("clamps a huge override below MAX_UINT32", () => {
    process.env[ENV_VAR] = "999999999999";
    expect(maxVolumeBytes()).toBeLessThan(MAX_UINT32);
  });

  it("accepts a scientific-notation override without crashing", () => {
    process.env[ENV_VAR] = "3.5e9";
    expect(maxVolumeBytes()).toBe(3_500_000_000);
  });

  it("clamps a too-small positive value up to 1 MiB", () => {
    process.env[ENV_VAR] = "500";
    expect(maxVolumeBytes()).toBe(MIN_VOLUME_BYTES);
  });

  it("always returns a value strictly below MAX_UINT32, across hostile inputs", () => {
    const hostileInputs = ["999999999999", "abc", "", "-1", "3.5e9", "0"];
    for (const value of hostileInputs) {
      process.env[ENV_VAR] = value;
      expect(maxVolumeBytes()).toBeLessThan(MAX_UINT32);
    }
  });
});
