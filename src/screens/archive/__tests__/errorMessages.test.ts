import { describe, expect, it } from "vitest";
import {
  mapArchiveErrorCodeToMessage,
  mapKnownArchiveErrorCode,
} from "../errorMessages.js";

describe("mapKnownArchiveErrorCode", () => {
  it.each([
    "mkdir:ENOSPC",
    "ENOENT",
    "file-changed",
    "verify-failed",
    "entry-too-large",
    "collision-exhausted",
    "EACCES",
    "EPERM",
    "ENOSPC",
    "EROFS",
  ])("returns a non-null message for %s", (code) => {
    expect(mapKnownArchiveErrorCode(code)).not.toBeNull();
  });

  it("returns null for an unrecognized code (used by the run-error screen to skip the message line)", () => {
    expect(mapKnownArchiveErrorCode("EBUSY")).toBeNull();
  });

  it.each([
    ["mkdir:EACCES", "impossible de créer le sous-dossier « archived »"],
    [
      "ENOENT",
      "un enregistrement a changé ou disparu pendant la création du zip — réessayez",
    ],
    [
      "file-changed",
      "un enregistrement a changé ou disparu pendant la création du zip — réessayez",
    ],
    [
      "verify-failed",
      "chiro n'a pas pu vérifier que le zip était complet — il n'a pas été conservé, vos enregistrements sont intacts ; réessayez",
    ],
    [
      "entry-too-large",
      "un enregistrement est trop volumineux pour être mis dans le zip — transmettez le détail technique",
    ],
    [
      "collision-exhausted",
      "plusieurs zips ont déjà été créés dans la même minute — patientez une minute puis réessayez",
    ],
    [
      "ENOSPC",
      "plus de place sur le disque — libérez de l'espace puis relancez",
    ],
    [
      "EROFS",
      "ce disque est protégé en écriture — copiez les fichiers ailleurs puis relancez",
    ],
  ] as const)("wording for %s matches the plan verbatim", (code, expected) => {
    expect(mapKnownArchiveErrorCode(code)).toBe(expected);
  });
});

describe("mapArchiveErrorCodeToMessage", () => {
  it("falls back to the generic message for an unrecognized code", () => {
    expect(mapArchiveErrorCodeToMessage("EBUSY")).toBe(
      "erreur inattendue (code: EBUSY)",
    );
  });

  it("returns the specific message for a known code", () => {
    expect(mapArchiveErrorCodeToMessage("verify-failed")).toContain(
      "vos enregistrements sont intacts",
    );
  });
});
