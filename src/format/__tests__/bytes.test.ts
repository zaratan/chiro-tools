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
