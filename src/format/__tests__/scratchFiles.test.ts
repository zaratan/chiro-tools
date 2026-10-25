import { describe, expect, it } from "vitest";
import { formatScratchFilesIgnored } from "../scratchFiles.js";

describe("formatScratchFilesIgnored", () => {
  it("uses the singular for one file", () => {
    expect(formatScratchFilesIgnored(1)).toBe(
      "(1 fichier temporaire de l'enregistreur ignoré)",
    );
  });

  it("agrees count, noun and participle in the plural", () => {
    expect(formatScratchFilesIgnored(2)).toBe(
      "(2 fichiers temporaires de l'enregistreur ignorés)",
    );
  });
});
