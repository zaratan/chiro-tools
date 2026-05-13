import { describe, expect, it } from "vitest";
import { parseSourceTimestamp } from "../parseTimestamp.js";

describe("parseSourceTimestamp", () => {
  it("extracts a Teensy filename with the chiro prefix (avoids partial year match)", () => {
    const ts = parseSourceTimestamp(
      "Car340581-2026-Pass1-Z5-PaRecPR1925645_20260507_211006.wav",
    );
    expect(ts).not.toBeNull();
    if (ts === null) throw new Error("ts null");
    expect(ts.getFullYear()).toBe(2026);
    expect(ts.getMonth()).toBe(4);
    expect(ts.getDate()).toBe(7);
    expect(ts.getHours()).toBe(21);
    expect(ts.getMinutes()).toBe(10);
    expect(ts.getSeconds()).toBe(6);
  });

  it("extracts an AudioMoth filename (no prefix, T suffix)", () => {
    const ts = parseSourceTimestamp("20260507_210501T.WAV");
    expect(ts).not.toBeNull();
    if (ts === null) throw new Error("ts null");
    expect(ts.getHours()).toBe(21);
    expect(ts.getMinutes()).toBe(5);
    expect(ts.getSeconds()).toBe(1);
  });

  it("extracts an AudioMoth filename with the chiro prefix", () => {
    const ts = parseSourceTimestamp(
      "Car340581-2026-Pass2-Z5-20260507_210501T.WAV",
    );
    expect(ts).not.toBeNull();
    if (ts === null) throw new Error("ts null");
    expect(ts.getFullYear()).toBe(2026);
  });

  it("returns null when no YYYYMMDD_HHMMSS pattern is present", () => {
    expect(parseSourceTimestamp("random-file.wav")).toBeNull();
    expect(parseSourceTimestamp("Car340581-2026-Pass1-Z5.wav")).toBeNull();
  });

  it("does not match a 2026 year in the chiro prefix alone", () => {
    // The chiro prefix has -2026- but no full YYYYMMDD_HHMMSS — must not match.
    expect(parseSourceTimestamp("Car340581-2026-Pass1-Z5-foo.wav")).toBeNull();
  });

  it("returns null for invalid date components", () => {
    expect(parseSourceTimestamp("foo_20261307_120000.wav")).toBeNull(); // month 13
    expect(parseSourceTimestamp("foo_20260507_256000.wav")).toBeNull(); // hour 25
  });

  it("handles full path prefixes (slashes before the date)", () => {
    const ts = parseSourceTimestamp(
      "/tmp/chiro/Car340581-2026-Pass1-Z5-PaRecPR1925645_20260507_211006.wav",
    );
    expect(ts).not.toBeNull();
  });
});
