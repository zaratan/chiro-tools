import { describe, expect, it } from "vitest";
import { formatBytes } from "../bytes.js";

describe("formatBytes", () => {
  it("formats sub-KB values in octets", () => {
    expect(formatBytes(0)).toBe("0 octets");
    expect(formatBytes(500)).toBe("500 octets");
    expect(formatBytes(1023)).toBe("1023 octets");
  });

  it("formats KB values with no decimal", () => {
    expect(formatBytes(1024)).toBe("1 Ko");
    expect(formatBytes(2048)).toBe("2 Ko");
    expect(formatBytes(1024 * 1023)).toBe("1023 Ko");
  });

  it("formats MB values with no decimal", () => {
    expect(formatBytes(1024 * 1024)).toBe("1 Mo");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 Mo");
    expect(formatBytes(1024 * 1024 * 1023)).toBe("1023 Mo");
  });

  it("formats GB values with one decimal, French comma separator", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1,0 Go");
    expect(formatBytes(Math.round(1.4 * 1024 ** 3))).toBe("1,4 Go");
    expect(formatBytes(24.8 * 1024 ** 3)).toBe("24,8 Go");
  });
});

describe("formatBytes — boundaries", () => {
  it("says « 1 octet » in the singular", () => {
    expect(formatBytes(1)).toBe("1 octet");
    expect(formatBytes(2)).toBe("2 octets");
  });

  it("never renders a rounded value that reads as the next bucket", () => {
    // 1 048 570 is 1023,99… Ko: rounding it to "1024 Ko" shows a number no
    // reader expects. Same at the Mo/Go boundary.
    expect(formatBytes(1_048_570)).toBe("1 Mo");
    expect(formatBytes(1024 ** 3 - 100)).toBe("1,0 Go");
  });
});
