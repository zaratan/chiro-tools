import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { metadataEnabled } from "./metadataEnabled.js";

describe("metadataEnabled", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env.CHIRO_DISABLE_METADATA;
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env.CHIRO_DISABLE_METADATA;
    } else {
      process.env.CHIRO_DISABLE_METADATA = original;
    }
  });

  it("returns true when the env var is unset", () => {
    delete process.env.CHIRO_DISABLE_METADATA;
    expect(metadataEnabled()).toBe(true);
  });

  it("returns false when the env var is exactly '1'", () => {
    process.env.CHIRO_DISABLE_METADATA = "1";
    expect(metadataEnabled()).toBe(false);
  });

  it("returns true for any other value", () => {
    process.env.CHIRO_DISABLE_METADATA = "true";
    expect(metadataEnabled()).toBe(true);
  });
});
