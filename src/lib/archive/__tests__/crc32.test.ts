import { describe, expect, it } from "vitest";
import { CRC32_INITIAL, crc32Final, crc32Update } from "../crc32.js";

const crc32 = (data: Uint8Array): number =>
  crc32Final(crc32Update(CRC32_INITIAL, data));

describe("crc32", () => {
  it("matches the well-known CRC-32 of the ASCII check string", () => {
    expect(crc32(Buffer.from("123456789", "ascii"))).toBe(0xcbf43926);
  });

  it("returns 0 for empty input", () => {
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });

  it("is deterministic across repeated calls on the same input", () => {
    const data = Buffer.from("chiro-tools archive module", "utf8");
    expect(crc32(data)).toBe(crc32(data));
  });

  it("produces the same result incrementally split across chunks as in one shot", () => {
    const data = Buffer.from(
      "The quick brown fox jumps over the lazy dog — Vigie-Chiro",
      "utf8",
    );
    const oneShot = crc32(data);

    let running = CRC32_INITIAL;
    for (let i = 0; i < data.length; i += 7) {
      running = crc32Update(running, data.subarray(i, i + 7));
    }
    const incremental = crc32Final(running);

    expect(incremental).toBe(oneShot);
  });

  it("differs for different inputs (sanity check against a trivial constant)", () => {
    expect(crc32(Buffer.from("a"))).not.toBe(crc32(Buffer.from("b")));
  });
});
