import { describe, expect, it } from "vitest";
import { mapErrorCodeToMessage, mapKnownErrorCode } from "../errorMessages.js";

describe("mapKnownErrorCode", () => {
  it.each(["EEXIST", "EACCES", "EPERM", "ENOENT", "DUPLICATED (ENOENT)"])(
    "returns a non-null message for %s",
    (code) => {
      expect(mapKnownErrorCode(code)).not.toBeNull();
    },
  );

  it("returns null for an unrecognized code (used by the run-error screen to skip the message line)", () => {
    expect(mapKnownErrorCode("EBUSY")).toBeNull();
  });
});

describe("mapErrorCodeToMessage", () => {
  it("falls back to the generic message for an unrecognized code", () => {
    expect(mapErrorCodeToMessage("EBUSY")).toBe(
      "erreur inattendue (code: EBUSY)",
    );
  });

  it("returns the specific message for a known code", () => {
    expect(mapErrorCodeToMessage("ENOENT")).toBe(
      "le fichier a disparu pendant l'opération",
    );
  });
});
