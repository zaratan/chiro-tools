import { randomBytes } from "node:crypto";
import { deflateRawSync, type ZlibOptions } from "node:zlib";
import { describe, expect, it } from "vitest";
import { deflateBound } from "../deflateBound.js";

// Incompressible (random) data is deliberately used here — real WAV audio
// compresses well and would mask a bound violation that only shows up on
// data deflate can't shrink.
const SMALL_SIZE = 4 * 1024;
const LARGE_SIZE = 900 * 1024;

const CONFIGS: { label: string; options: ZlibOptions }[] = [
  { label: "level:6 (default)", options: { level: 6 } },
  { label: "level:1", options: { level: 1 } },
  { label: "level:9", options: { level: 9 } },
  { label: "level:6, memLevel:1", options: { level: 6, memLevel: 1 } },
  { label: "level:6, windowBits:9", options: { level: 6, windowBits: 9 } },
];

describe("deflateBound", () => {
  describe.each(CONFIGS)("$label", ({ options }) => {
    it.each([
      ["small", SMALL_SIZE],
      ["large", LARGE_SIZE],
    ])("holds for a %s incompressible input", (_label, size) => {
      const data = randomBytes(size);
      const compressed = deflateRawSync(data, options);
      expect(compressed.length).toBeLessThanOrEqual(deflateBound(size));
    });
  });
});
