import { describe, expect, it } from "vitest";
import { mapKnownFsErrorCode } from "./fsErrorMessages.js";

describe("mapKnownFsErrorCode", () => {
  it.each([
    ["EACCES", "permission refusée par le système"],
    ["EPERM", "permission refusée par le système"],
    [
      "ENOSPC",
      "plus de place sur le disque — libérez de l'espace puis relancez",
    ],
    [
      "EROFS",
      "ce disque est protégé en écriture — copiez les fichiers ailleurs puis relancez",
    ],
  ] as const)("maps %s verbatim", (code, expected) => {
    expect(mapKnownFsErrorCode(code)).toBe(expected);
  });

  it("returns null for a code outside the shared common set", () => {
    expect(mapKnownFsErrorCode("ENOENT")).toBeNull();
    expect(mapKnownFsErrorCode("EBUSY")).toBeNull();
  });
});
