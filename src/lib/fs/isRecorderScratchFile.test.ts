import { describe, expect, it } from "vitest";
import { isRecorderScratchFile } from "./isRecorderScratchFile.js";

describe("isRecorderScratchFile", () => {
  it.each([
    "temp.wav",
    "TEMP.WAV",
    "Test.wav",
    "test.WAV",
    "Car123456-2026-Pass1-A1-temp.wav",
    "car123456-2026-Pass12-Z3-Test.wav",
    "Brut/temp.wav",
  ])("recognizes %s, whatever its case or prefix", (name) => {
    expect(isRecorderScratchFile(name)).toBe(true);
  });

  it.each([
    "mytemp.wav",
    "temp2.wav",
    "temp.wav.wav",
    "temp.txt",
    "Car123456-2026-Pass1-A1-PR01 temp.wav",
    "PaRec340581_temp.wav",
    "Brut/PaRec340581_20260814_223000.wav",
  ])("keeps %s, a real recording or another file", (name) => {
    expect(isRecorderScratchFile(name)).toBe(false);
  });
});
