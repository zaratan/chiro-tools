import { describe, expect, it } from "vitest";
import { buildWamdChunk, type WamdMeta } from "../wamd.js";

const sampleMeta = (overrides: Partial<WamdMeta> = {}): WamdMeta => ({
  timestamp: new Date(2026, 4, 7, 21, 11, 6),
  timeExpansion: 10,
  software: "chiro 0.1.2",
  ...overrides,
});

type ParsedRecord = {
  tag: number;
  value: Buffer;
};

const parseWamdContent = (
  buf: Buffer,
): { id: string; size: number; records: ParsedRecord[] } => {
  const id = buf.subarray(0, 4).toString("ascii");
  const size = buf.readUInt32LE(4);
  const records: ParsedRecord[] = [];
  let offset = 8;
  while (offset < 8 + size) {
    const tag = buf.readUInt16LE(offset);
    const length = buf.readUInt32LE(offset + 2);
    const value = buf.subarray(offset + 6, offset + 6 + length);
    records.push({ tag, value });
    offset += 6 + length;
  }
  return { id, size, records };
};

describe("buildWamdChunk", () => {
  it("emits a chunk with id 'wamd' and a uint32 LE size", () => {
    const buf = buildWamdChunk(sampleMeta());
    const { id, size, records } = parseWamdContent(buf);

    expect(id).toBe("wamd");
    expect(size).toBeGreaterThan(0);
    expect(records.length).toBeGreaterThanOrEqual(3);
  });

  it("writes WA Version (tag 0x0000) as uint16 LE = 1", () => {
    const buf = buildWamdChunk(sampleMeta());
    const { records } = parseWamdContent(buf);
    const wa = records.find((r) => r.tag === 0x0000);
    if (!wa) throw new Error("missing WA Version record");
    expect(wa.value.byteLength).toBe(2);
    expect(wa.value.readUInt16LE(0)).toBe(1);
  });

  it("writes Time Expansion (tag 0x000F) as uint16 LE", () => {
    const buf = buildWamdChunk(sampleMeta({ timeExpansion: 10 }));
    const { records } = parseWamdContent(buf);
    const te = records.find((r) => r.tag === 0x000f);
    if (!te) throw new Error("missing TE record");
    expect(te.value.byteLength).toBe(2);
    expect(te.value.readUInt16LE(0)).toBe(10);
  });

  it("writes Timestamp (tag 0x0005) as ISO string with TZ offset", () => {
    const buf = buildWamdChunk(sampleMeta());
    const { records } = parseWamdContent(buf);
    const ts = records.find((r) => r.tag === 0x0005);
    if (!ts) throw new Error("missing Timestamp record");
    expect(ts.value.toString("utf8")).toMatch(
      /^2026-05-07 21:11:06[+-]\d{2}:\d{2}$/,
    );
  });

  it("writes Software (tag 0x0008) as UTF-8 string without null terminator", () => {
    const buf = buildWamdChunk(sampleMeta({ software: "chiro 0.9.0" }));
    const { records } = parseWamdContent(buf);
    const sw = records.find((r) => r.tag === 0x0008);
    if (!sw) throw new Error("missing Software record");
    expect(sw.value.toString("utf8")).toBe("chiro 0.9.0");
    // 18 chars equivalent to Kaleidoscope's "Kaleidoscope 5.9.1" pattern
    expect(sw.value.byteLength).toBe(11);
  });

  it("omits the Timestamp record when timestamp is null", () => {
    const buf = buildWamdChunk(sampleMeta({ timestamp: null }));
    const { records } = parseWamdContent(buf);
    expect(records.find((r) => r.tag === 0x0005)).toBeUndefined();
  });

  it("emits records in the order [WA Version, TE, Timestamp, Software]", () => {
    const buf = buildWamdChunk(sampleMeta());
    const { records } = parseWamdContent(buf);
    expect(records.map((r) => r.tag)).toEqual([0x0000, 0x000f, 0x0005, 0x0008]);
  });

  it("pads to even byte length when content size is odd", () => {
    // Force odd content via odd-length software string.
    const buf = buildWamdChunk(sampleMeta({ software: "ab" }));
    expect(buf.byteLength % 2).toBe(0);
  });
});
