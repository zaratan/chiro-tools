import { describe, expect, it } from "vitest";
import { classifySampleRate, detectBatchMode } from "../detectMode.js";

describe("classifySampleRate", () => {
  it.each([2400, 4800, 9600, 19200, 25000, 38400, 50000])(
    "keeps %i Hz as is: a Teensy rate in time expansion ×10",
    (rate) => {
      expect(classifySampleRate(rate)).toBe("preserve");
    },
  );

  it.each([
    ["an AudioMoth", 250000],
    ["a Teensy set to X1", 384000],
    ["the lowest Teensy X1 rate", 24000],
    ["a rate between two X10 rates", 48000],
    ["the highest Teensy X1 rate", 500000],
  ])("slows down %s (%i Hz) 10×", (_label, rate) => {
    expect(classifySampleRate(rate)).toBe("expand-10x");
  });

  it.each([23999, 22050, 8000, 0])(
    "cannot classify %i Hz, below every real-time recorder rate",
    (rate) => {
      expect(classifySampleRate(rate)).toBe("unclassifiable");
    },
  );
});

describe("detectBatchMode", () => {
  const rec = (file: string, sampleRate: number) => ({ file, sampleRate });

  it("keeps a batch of Teensy X10 recordings as is", () => {
    expect(detectBatchMode([rec("a.wav", 38400), rec("b.wav", 25000)])).toEqual(
      {
        kind: "ok",
        mode: "preserve",
      },
    );
  });

  it("slows down a batch of AudioMoth and Teensy X1 recordings", () => {
    expect(
      detectBatchMode([rec("a.wav", 250000), rec("b.wav", 384000)]),
    ).toEqual({
      kind: "ok",
      mode: "expand-10x",
    });
  });

  it("refuses a mixed batch and lists each family", () => {
    expect(
      detectBatchMode([
        rec("a.wav", 38400),
        rec("b.wav", 250000),
        rec("c.wav", 38400),
      ]),
    ).toEqual({
      kind: "mixed",
      preserve: [rec("a.wav", 38400), rec("c.wav", 38400)],
      expand: [rec("b.wav", 250000)],
    });
  });

  it("reports every unclassifiable recording with its rate, before any mix", () => {
    expect(
      detectBatchMode([
        rec("a.wav", 38400),
        rec("b.wav", 22050),
        rec("c.wav", 250000),
        rec("d.wav", 8000),
      ]),
    ).toEqual({
      kind: "unclassifiable",
      files: [rec("b.wav", 22050), rec("d.wav", 8000)],
    });
  });

  it("has nothing to decide when no recording was admitted", () => {
    expect(detectBatchMode([])).toEqual({ kind: "empty" });
  });
});
