import { describe, expect, it } from "vitest";
import {
  isTransientOffsiteError,
  mapKnownOffsiteErrorCode,
} from "../errorMessages.js";

describe("isTransientOffsiteError", () => {
  it("treats bucket-missing, config-error, rclone-spawn-failed and fatal as definitive", () => {
    expect(isTransientOffsiteError("bucket-missing")).toBe(false);
    expect(isTransientOffsiteError("config-error")).toBe(false);
    expect(isTransientOffsiteError("rclone-spawn-failed")).toBe(false);
    expect(isTransientOffsiteError("fatal")).toBe(false);
  });

  it("treats the run's transient codes as transient", () => {
    expect(isTransientOffsiteError("transient")).toBe(true);
    expect(isTransientOffsiteError("rclone-exit:5")).toBe(true);
    expect(isTransientOffsiteError("rclone-exit:42")).toBe(true);
    expect(isTransientOffsiteError("verify-failed")).toBe(true);
    expect(isTransientOffsiteError("verify-absent")).toBe(true);
  });

  it("treats every other code as transient by default", () => {
    expect(isTransientOffsiteError("network")).toBe(true);
    expect(isTransientOffsiteError("timeout")).toBe(true);
    expect(isTransientOffsiteError("unparseable-lsjson")).toBe(true);
  });
});

describe("mapKnownOffsiteErrorCode", () => {
  it("returns the same message for bucket-missing and config-error", () => {
    const bucketMessage = mapKnownOffsiteErrorCode("bucket-missing");
    const configMessage = mapKnownOffsiteErrorCode("config-error");
    expect(bucketMessage).not.toBeNull();
    expect(bucketMessage).toBe(configMessage);
    expect(bucketMessage).toContain("Ce réglage se fait sur l'ordinateur");
  });

  it("gives verify-failed and verify-absent distinct 'recommencer' messages", () => {
    expect(mapKnownOffsiteErrorCode("verify-failed")).toContain(
      "recommencer l'archivage",
    );
    expect(mapKnownOffsiteErrorCode("verify-absent")).toContain(
      "recommencer l'archivage",
    );
    expect(mapKnownOffsiteErrorCode("verify-failed")).not.toBe(
      mapKnownOffsiteErrorCode("verify-absent"),
    );
  });

  it("maps rclone-spawn-failed to a chiro-side message", () => {
    expect(mapKnownOffsiteErrorCode("rclone-spawn-failed")).toContain(
      "chiro n'a pas réussi à lancer",
    );
  });

  it("gives the same generic message to transient and any other rclone-exit:<N>", () => {
    const transientMessage = mapKnownOffsiteErrorCode("transient");
    expect(transientMessage).toContain("réessayez");
    expect(mapKnownOffsiteErrorCode("rclone-exit:42")).toBe(transientMessage);
  });

  it("gives fatal its own non-retry message", () => {
    const message = mapKnownOffsiteErrorCode("fatal");
    expect(message).not.toBeNull();
    expect(message).not.toContain("réessayez");
  });

  it("returns null for unrecognized codes", () => {
    expect(mapKnownOffsiteErrorCode("network")).toBeNull();
    expect(mapKnownOffsiteErrorCode("unparseable-lsjson")).toBeNull();
  });
});
