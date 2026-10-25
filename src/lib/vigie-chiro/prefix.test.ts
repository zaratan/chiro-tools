import { describe, expect, it } from "vitest";
import {
  buildPrefix,
  formInputFromPrefix,
  readCommonFormInput,
} from "./prefix.js";

describe("buildPrefix", () => {
  it("generates the nominal prefix", () => {
    expect(
      buildPrefix({
        squareCode: "040962",
        year: 2026,
        passNumber: 3,
        pointCode: "A1",
      }),
    ).toBe("Car040962-2026-Pass3-A1-");
  });

  it("preserves the leading zero for departments 1-9 (squareCode '010001')", () => {
    const prefix = buildPrefix({
      squareCode: "010001",
      year: 2026,
      passNumber: 3,
      pointCode: "A1",
    });
    expect(prefix).toContain("Car010001-");
  });

  it("normalizes the point code to uppercase", () => {
    const prefix = buildPrefix({
      squareCode: "040962",
      year: 2026,
      passNumber: 3,
      pointCode: "a1",
    });
    expect(prefix).toContain("A1");
    expect(prefix).not.toContain("a1");
  });

  it("handles a 3-digit pass number (100)", () => {
    const prefix = buildPrefix({
      squareCode: "040962",
      year: 2026,
      passNumber: 100,
      pointCode: "A1",
    });
    expect(prefix).toContain("Pass100");
  });

  it("includes the year 1900 correctly", () => {
    const prefix = buildPrefix({
      squareCode: "040962",
      year: 1900,
      passNumber: 1,
      pointCode: "A1",
    });
    expect(prefix).toContain("1900");
  });
});

describe("formInputFromPrefix", () => {
  it("reads the four form values back from a prefix", () => {
    expect(formInputFromPrefix("Car040962-2026-Pass3-A1-")).toEqual({
      squareCode: "040962",
      year: 2026,
      passNumber: 3,
      pointCode: "A1",
    });
  });

  it("gives back exactly the same prefix once rebuilt", () => {
    const prefix = "Car123456-2026-Pass12-Z9-";
    const input = formInputFromPrefix(prefix);

    expect(input === null ? null : buildPrefix(input)).toBe(prefix);
  });

  it("refuses a pass number with a leading zero, which would be rebuilt differently", () => {
    expect(formInputFromPrefix("Car040962-2026-Pass03-A1-")).toBeNull();
  });

  it("refuses a lowercase point, which would be rebuilt in uppercase", () => {
    expect(formInputFromPrefix("Car040962-2026-Pass3-a1-")).toBeNull();
  });

  it("refuses a point the form would not accept", () => {
    expect(formInputFromPrefix("Car040962-2026-Pass3-ETANG-")).toBeNull();
  });

  it("refuses a year the form would not accept", () => {
    expect(formInputFromPrefix("Car040962-1800-Pass3-A1-")).toBeNull();
  });

  it("refuses a pass number of zero", () => {
    expect(formInputFromPrefix("Car040962-2026-Pass0-A1-")).toBeNull();
  });

  it("refuses anything that is not a prefix", () => {
    expect(formInputFromPrefix("PaRec1_205005")).toBeNull();
  });
});

describe("readCommonFormInput", () => {
  const pass1 = {
    squareCode: "123456",
    year: 2026,
    passNumber: 1,
    pointCode: "A1",
  };

  it("reads the values every prefixed file shares", () => {
    expect(
      readCommonFormInput([
        "Car123456-2026-Pass1-A1-a.wav",
        "Car123456-2026-Pass1-A1-b.wav",
      ]),
    ).toEqual(pass1);
  });

  it("ignores raw recordings left in the folder, as after a stop halfway through", () => {
    expect(
      readCommonFormInput([
        "Car123456-2026-Pass1-A1-a.wav",
        "PaRec1_205010.wav",
      ]),
    ).toEqual(pass1);
  });

  it("reads files inside Brut/ by their base name", () => {
    expect(readCommonFormInput(["Brut/Car123456-2026-Pass1-A1-a.wav"])).toEqual(
      pass1,
    );
  });

  it("reads a name whose Teensy prefix left a space", () => {
    expect(
      readCommonFormInput(["Car123456-2026-Pass1-A1-PR01 PR1_205005.wav"]),
    ).toEqual(pass1);
  });

  it("gives nothing when the prefixed files disagree", () => {
    expect(
      readCommonFormInput([
        "Car123456-2026-Pass1-A1-a.wav",
        "Car123456-2026-Pass2-A1-b.wav",
      ]),
    ).toBeNull();
  });

  it("gives nothing when no file is prefixed", () => {
    expect(readCommonFormInput(["PaRec1_205005.wav"])).toBeNull();
  });

  it("gives nothing for a lowercase point, which the form would turn into another prefix", () => {
    expect(readCommonFormInput(["Car123456-2026-Pass1-a1-a.wav"])).toBeNull();
  });
});
