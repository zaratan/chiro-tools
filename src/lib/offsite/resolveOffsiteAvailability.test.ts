import { describe, expect, it } from "vitest";
import { resolveOffsiteAvailability } from "./resolveOffsiteAvailability.js";
import type { RcloneAvailability } from "./detectRclone.js";
import type { LoadSettingsResult, OffsiteSettings } from "./settings.js";

const SETTINGS: OffsiteSettings = {
  remote: "scaleway",
  bucket: "chiro-manon",
  prefix: "backups",
};

const AVAILABLE_RCLONE: RcloneAvailability = {
  kind: "available",
  binPath: "/usr/local/bin/rclone",
  version: "1.75.0",
};

const OK_SETTINGS: LoadSettingsResult = { kind: "ok", settings: SETTINGS };

describe("resolveOffsiteAvailability", () => {
  it("is available when rclone is available and settings are valid", () => {
    const result = resolveOffsiteAvailability(AVAILABLE_RCLONE, OK_SETTINGS);
    expect(result).toEqual({
      kind: "available",
      binPath: "/usr/local/bin/rclone",
      settings: SETTINGS,
    });
  });

  it("is unavailable when rclone is absent", () => {
    const result = resolveOffsiteAvailability({ kind: "absent" }, OK_SETTINGS);
    expect(result).toEqual({ kind: "unavailable" });
  });

  it("is unavailable when rclone is too old", () => {
    const result = resolveOffsiteAvailability(
      { kind: "too-old", binPath: "/usr/local/bin/rclone", version: "1.40.0" },
      OK_SETTINGS,
    );
    expect(result).toEqual({ kind: "unavailable" });
  });

  it("is unavailable when settings are absent", () => {
    const result = resolveOffsiteAvailability(AVAILABLE_RCLONE, {
      kind: "absent",
    });
    expect(result).toEqual({ kind: "unavailable" });
  });

  it("is unavailable when settings are invalid", () => {
    const result = resolveOffsiteAvailability(AVAILABLE_RCLONE, {
      kind: "invalid",
      reason: "not JSON",
    });
    expect(result).toEqual({ kind: "unavailable" });
  });

  it("is unavailable when both rclone and settings fail", () => {
    const result = resolveOffsiteAvailability(
      { kind: "absent" },
      { kind: "absent" },
    );
    expect(result).toEqual({ kind: "unavailable" });
  });
});
