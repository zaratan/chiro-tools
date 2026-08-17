import { describe, expect, it } from "vitest";
import { formatDayMonth, formatDayMonthYear, formatTimeOfDay } from "./date.js";

describe("formatDayMonthYear", () => {
  it("pads single-digit day and month", () => {
    expect(formatDayMonthYear(new Date(2026, 7, 6))).toBe("06/08/2026");
  });

  it("does not pad the year", () => {
    expect(formatDayMonthYear(new Date(2026, 7, 16))).toBe("16/08/2026");
  });
});

describe("formatDayMonth", () => {
  it("pads single-digit day and month", () => {
    expect(formatDayMonth(new Date(2026, 0, 3))).toBe("03/01");
  });

  it("omits the year", () => {
    expect(formatDayMonth(new Date(2026, 7, 14))).toBe("14/08");
  });
});

describe("formatTimeOfDay", () => {
  it("does not pad the hour", () => {
    expect(formatTimeOfDay(new Date(2026, 7, 15, 2, 47))).toBe("2 h 47");
  });

  it("pads single-digit minutes", () => {
    expect(formatTimeOfDay(new Date(2026, 7, 15, 8, 5))).toBe("8 h 05");
  });

  it("handles midnight and a double-digit hour", () => {
    expect(formatTimeOfDay(new Date(2026, 7, 15, 0, 0))).toBe("0 h 00");
    expect(formatTimeOfDay(new Date(2026, 7, 15, 23, 59))).toBe("23 h 59");
  });
});
