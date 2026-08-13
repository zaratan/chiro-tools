import { describe, expect, it } from "vitest";
import {
  FALLBACK_INSTALL_SCRIPT_URL,
  GITHUB_REPO,
  INSTALL_SCRIPT_URL,
} from "./constants.js";
import { CHIRO_VERSION } from "../../version.js";

describe("INSTALL_SCRIPT_URL — pinned to this binary's own release tag", () => {
  it("matches the exact expected URL shape", () => {
    const expected = `https://raw.githubusercontent.com/${GITHUB_REPO}/v${CHIRO_VERSION}/scripts/install.sh`;
    expect(INSTALL_SCRIPT_URL).toBe(expected);
  });

  it("does not point at main", () => {
    expect(INSTALL_SCRIPT_URL).not.toContain("/main/");
  });
});

describe("FALLBACK_INSTALL_SCRIPT_URL — manual first-install fallback", () => {
  it("points at main/scripts/install.sh", () => {
    expect(FALLBACK_INSTALL_SCRIPT_URL).toContain("/main/scripts/install.sh");
  });

  it("differs from the pinned INSTALL_SCRIPT_URL", () => {
    expect(FALLBACK_INSTALL_SCRIPT_URL).not.toBe(INSTALL_SCRIPT_URL);
  });
});
