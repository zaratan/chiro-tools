import { describe, expect, it } from "vitest";
import { describeScanOrigin } from "../scanOrigin.js";

describe("describeScanOrigin", () => {
  it("returns null when no subfolder was found", () => {
    expect(describeScanOrigin(null, 8, 0)).toBeNull();
  });

  it("returns null when a subfolder exists but contributed nothing", () => {
    expect(describeScanOrigin("Brut", 8, 0)).toBeNull();
  });

  it("returns 'all-sub' when everything comes from the subfolder", () => {
    expect(describeScanOrigin("Brut", 0, 412)).toEqual({
      kind: "all-sub",
      label: "./Brut/",
    });
  });

  it("returns 'mixed' with both counts when both locations contributed", () => {
    expect(describeScanOrigin("Brut", 8, 404)).toEqual({
      kind: "mixed",
      label: "./Brut/",
      rootCount: 8,
      subCount: 404,
    });
  });

  it("uses the subfolder's actual on-disk name/case in the label", () => {
    expect(describeScanOrigin("BRUTS", 0, 3)).toEqual({
      kind: "all-sub",
      label: "./BRUTS/",
    });
  });
});
