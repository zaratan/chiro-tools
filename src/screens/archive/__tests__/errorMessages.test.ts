import { describe, expect, it } from "vitest";
import {
  isTransientArchiveError,
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
    "zip64-required",
    "collision-exhausted",
    "EACCES",
    "EPERM",
    "ENOSPC",
    "EROFS",
  ])("returns a non-null message for %s", (code) => {
    expect(mapKnownArchiveErrorCode(code, "archived")).not.toBeNull();
  });

  it("returns null for an unrecognized code (used by the run-error screen to skip the message line)", () => {
    expect(mapKnownArchiveErrorCode("EBUSY", "archived")).toBeNull();
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
      "zip64-required",
      "chiro n'a pas réussi à préparer des fichiers acceptés par Vigie-Chiro — transmettez le détail technique",
    ],
    [
      "collision-exhausted",
      "trop de fichiers zip portent déjà ce nom — renommez ou rangez ceux du jour, puis réessayez",
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
    expect(mapKnownArchiveErrorCode(code, "archived")).toBe(expected);
  });

  it("substitutes the dirLabel into the mkdir message rather than hard-coding 'archived'", () => {
    expect(mapKnownArchiveErrorCode("mkdir:EACCES", "upload")).toBe(
      "impossible de créer le sous-dossier « upload »",
    );
  });

  it.each([
    [
      "rename-volume:ENOSPC",
      "plus de place sur le disque — libérez de l'espace puis relancez",
    ],
    ["rename-volume:EACCES", "permission refusée par le système"],
  ] as const)(
    "keeps the actionable message for %s rather than dropping the line",
    (code, expected) => {
      // The run-error screen omits the message entirely on `null`, so an
      // unmapped prefix costs her the only line that says what to do — on
      // the most likely failure of a long run.
      expect(mapKnownArchiveErrorCode(code, "upload")).toBe(expected);
    },
  );

  it("still returns null for a rename-volume code it doesn't recognize", () => {
    expect(
      mapKnownArchiveErrorCode("rename-volume:EXDEV", "upload"),
    ).toBeNull();
  });
});

describe("mapArchiveErrorCodeToMessage", () => {
  it("falls back to the generic message for an unrecognized code", () => {
    expect(mapArchiveErrorCodeToMessage("EBUSY", "archived")).toBe(
      "erreur inattendue (code: EBUSY)",
    );
  });

  it("returns the specific message for a known code", () => {
    expect(mapArchiveErrorCodeToMessage("verify-failed", "archived")).toContain(
      "vos enregistrements sont intacts",
    );
  });
});

describe("isTransientArchiveError", () => {
  it.each([
    "ENOSPC",
    "EACCES",
    "EPERM",
    "ENOENT",
    "file-changed",
    "collision-exhausted",
    "verify-failed",
    "mkdir:ENOSPC",
    "mkdir:EACCES",
    "some-unknown-future-code",
  ])("is transient for %s", (code) => {
    expect(isTransientArchiveError(code)).toBe(true);
  });

  it.each(["zip64-required", "entry-too-large", "EROFS", "staging-stuck"])(
    "is definitive (not transient) for %s",
    (code) => {
      expect(isTransientArchiveError(code)).toBe(false);
    },
  );

  it.each(["mkdir:EROFS", "rename-volume:EROFS"])(
    "sees through the prefix: %s is definitive too",
    (code) => {
      // A read-only mount surfaces as `mkdir:EROFS` — the first mkdir is what
      // fails — so classifying on the raw string missed the very case the
      // definitive list was added for. The operation a failure happened
      // during says nothing about whether it can resolve itself.
      expect(isTransientArchiveError(code)).toBe(false);
    },
  );

  it.each(["mkdir:ENOSPC", "rename-volume:ENOSPC", "mkdir:EBUSY"])(
    "keeps a prefixed transient code transient: %s",
    (code) => {
      expect(isTransientArchiveError(code)).toBe(true);
    },
  );

  it("never offers a retry whose own message tells her to go elsewhere", () => {
    // EROFS reads "copiez les fichiers ailleurs puis relancez". Pairing that
    // with "Entrée réessayer" makes the screen contradict itself.
    const message = mapKnownArchiveErrorCode("EROFS", "upload");
    expect(message).toContain("ailleurs");
    expect(isTransientArchiveError("EROFS")).toBe(false);
  });
});
