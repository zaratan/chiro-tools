import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  UPLOAD_DIR_DISPLAY,
  UPLOAD_DIRNAME,
  buildSeriesDirName,
  buildStagingDirName,
  buildUploadDir,
  buildVolumeFileName,
} from "../planUpload.js";

describe("buildUploadDir / UPLOAD_DIR_DISPLAY", () => {
  it("joins the upload dirname onto the given directory", () => {
    expect(buildUploadDir("/home/user/bats")).toBe(
      path.join("/home/user/bats", UPLOAD_DIRNAME),
    );
  });

  it("exposes the display form used in UI copy", () => {
    expect(UPLOAD_DIR_DISPLAY).toBe("./upload/");
  });
});

describe("buildSeriesDirName", () => {
  it("formats as depot_YYYYMMDD when no prefix is given", () => {
    expect(buildSeriesDirName(new Date(2026, 7, 14, 15, 30))).toBe(
      "depot_20260814",
    );
  });

  it("zero-pads single-digit month and day", () => {
    expect(buildSeriesDirName(new Date(2026, 0, 2, 3, 4))).toBe(
      "depot_20260102",
    );
  });

  it("uses the given prefix instead of depot when provided", () => {
    expect(
      buildSeriesDirName(new Date(2026, 7, 14), "Car340581-2026-Pass1-A1"),
    ).toBe("Car340581-2026-Pass1-A1_20260814");
  });

  it("produces a bare directory name with no extension", () => {
    expect(path.extname(buildSeriesDirName(new Date(2026, 7, 14)))).toBe("");
  });
});

describe("buildVolumeFileName", () => {
  it("drops the part suffix entirely when there is only one volume", () => {
    expect(buildVolumeFileName("depot_20260814", 1, 1)).toBe(
      "depot_20260814.zip",
    );
  });

  it("uses unpadded part numbers for up to 9 volumes", () => {
    expect(buildVolumeFileName("depot_20260814", 1, 3)).toBe(
      "depot_20260814_part1.zip",
    );
    expect(buildVolumeFileName("depot_20260814", 3, 3)).toBe(
      "depot_20260814_part3.zip",
    );
  });

  it("zero-pads part numbers once the series has 10+ volumes", () => {
    expect(buildVolumeFileName("depot_20260814", 1, 12)).toBe(
      "depot_20260814_part01.zip",
    );
    expect(buildVolumeFileName("depot_20260814", 10, 12)).toBe(
      "depot_20260814_part10.zip",
    );
    expect(buildVolumeFileName("depot_20260814", 12, 12)).toBe(
      "depot_20260814_part12.zip",
    );
  });

  it("sorts lexicographically in file-system order once padded", () => {
    const names = Array.from({ length: 12 }, (_, i) =>
      buildVolumeFileName("depot_20260814", i + 1, 12),
    );
    const sorted = [...names].sort();
    expect(sorted).toEqual(names);
  });
});

describe("buildStagingDirName", () => {
  it("wraps the series name and pid with a leading dot and .tmpdir suffix", () => {
    expect(buildStagingDirName("depot_20260814", 4242)).toBe(
      ".depot_20260814.4242.tmpdir",
    );
  });

  it("never uses a bare .tmp suffix (would collide with ORPHAN_TMP_REGEX)", () => {
    expect(buildStagingDirName("depot_20260814", 4242)).not.toMatch(/\.tmp$/);
  });
});
