import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run as runPool } from "../splitWorkerPool.js";
import { runSoxBatch } from "../soxFastPath.js";

const TEST_DATA = path.resolve(__dirname, "../../../../test-data");
const REAL_DIR = path.join(TEST_DATA, "real_process_teensy");
const RAW_FILE =
  "Car340581-2026-Pass1-Z5-PaRecPR1925645_20260507_211006_Not_Processed.wav";

const realDataAvailable =
  existsSync(REAL_DIR) && existsSync(path.join(REAL_DIR, RAW_FILE));

const findSoxBin = (): string | null => {
  const pathEnv = process.env.PATH ?? "";
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, "sox");
    if (existsSync(candidate)) return candidate;
  }
  return null;
};

const SOX_BIN = findSoxBin();
const soxAvailable = SOX_BIN !== null;

type ParsedChunk = {
  id: string;
  size: number;
  body: Buffer;
};

const parseRiffChunks = (buf: Buffer): ParsedChunk[] => {
  expect(buf.subarray(0, 4).toString("ascii")).toBe("RIFF");
  expect(buf.subarray(8, 12).toString("ascii")).toBe("WAVE");
  const chunks: ParsedChunk[] = [];
  let pos = 12;
  while (pos + 8 <= buf.byteLength) {
    const id = buf.subarray(pos, pos + 4).toString("ascii");
    const size = buf.readUInt32LE(pos + 4);
    const body = buf.subarray(pos + 8, pos + 8 + size);
    chunks.push({ id, size, body });
    pos += 8 + size + (size % 2);
  }
  return chunks;
};

const parseGuanoLines = (body: Buffer): Map<string, string> => {
  const map = new Map<string, string>();
  for (const line of body.toString("utf8").split("\n")) {
    if (line.length === 0) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    map.set(line.slice(0, idx), line.slice(idx + 1));
  }
  return map;
};

const parseWamdRecords = (body: Buffer): Map<number, Buffer> => {
  const map = new Map<number, Buffer>();
  let offset = 0;
  while (offset + 6 <= body.byteLength) {
    const tag = body.readUInt16LE(offset);
    const length = body.readUInt32LE(offset + 2);
    map.set(tag, body.subarray(offset + 6, offset + 6 + length));
    offset += 6 + length;
  }
  return map;
};

describe.skipIf(!realDataAvailable)(
  "chiro vs Kaleidoscope on real Teensy data",
  () => {
    let workDir: string;

    beforeEach(async () => {
      workDir = await mkdtemp(path.join(tmpdir(), "chiro-vs-kalei-"));
    });

    afterEach(async () => {
      await rm(workDir, { recursive: true, force: true });
    });

    it("produces a WAV chunk aligned with the Kaleidoscope reference (header + GUANO + wamd)", async () => {
      await copyFile(
        path.join(REAL_DIR, RAW_FILE),
        path.join(workDir, RAW_FILE),
      );

      const outcome = await runPool(
        [RAW_FILE],
        workDir,
        { mode: "preserve" },
        {
          metadata: { enabled: true, chiroVersion: "1.0.0-test" },
        },
      );
      expect(outcome.errored).toEqual([]);
      expect(outcome.processed.length).toBe(1);

      const chunks = (await readdir(path.join(workDir, "processed"))).sort();
      expect(chunks.length).toBeGreaterThan(0);
      const firstChunk = chunks[0];
      if (firstChunk === undefined) throw new Error("no chunk produced");

      const firstChunkPath = path.join(workDir, "processed", firstChunk);
      const chunkBuf = await readFile(firstChunkPath);
      const parsed = parseRiffChunks(chunkBuf);
      const fmt = parsed.find((c) => c.id === "fmt ");
      const data = parsed.find((c) => c.id === "data");
      const guan = parsed.find((c) => c.id === "guan");
      const wamd = parsed.find((c) => c.id === "wamd");

      if (!fmt || !data || !guan || !wamd) {
        throw new Error(
          `Missing chunks. Found: ${parsed.map((c) => c.id).join(",")}`,
        );
      }

      // Header alignment with Kaleidoscope's PCM 1 channel 38400 Hz 16-bit
      expect(fmt.body.readUInt16LE(0)).toBe(1); // PCM
      expect(fmt.body.readUInt16LE(2)).toBe(1); // mono
      expect(fmt.body.readUInt32LE(4)).toBe(38400);
      expect(fmt.body.readUInt16LE(14)).toBe(16); // bit depth

      // GUANO key fields
      const guanoFields = parseGuanoLines(guan.body);
      expect(guanoFields.get("GUANO|Version")).toBe("1.0");
      expect(guanoFields.get("Samplerate")).toBe("384000");
      expect(guanoFields.get("TE")).toBe("10");
      expect(guanoFields.get("Original Filename")).toBe(RAW_FILE);
      expect(guanoFields.get("WA|chiro|Version")).toBe("1.0.0-test");
      // The raw fixture is ~20 s output = ~2 s real time → single tail chunk.
      // For full-size sources, Length would be exactly 5.000000.
      const length = guanoFields.get("Length");
      if (!length) throw new Error("missing Length");
      expect(parseFloat(length)).toBeGreaterThan(0);
      expect(parseFloat(length)).toBeLessThanOrEqual(5);

      // wamd key tags
      const wamdRecords = parseWamdRecords(wamd.body);
      expect(wamdRecords.has(0x0000)).toBe(true); // WA Version
      expect(wamdRecords.has(0x000f)).toBe(true); // TE
      expect(wamdRecords.get(0x000f)?.readUInt16LE(0)).toBe(10);
      expect(wamdRecords.has(0x0005)).toBe(true); // Timestamp
      expect(wamdRecords.has(0x0008)).toBe(true); // Software
      expect(wamdRecords.get(0x0008)?.toString("utf8")).toBe(
        "chiro 1.0.0-test",
      );
    });

    it.skipIf(!soxAvailable)(
      "sox pipeline produces a byte-identical chunk to the worker pool (with metadata)",
      async () => {
        await copyFile(
          path.join(REAL_DIR, RAW_FILE),
          path.join(workDir, RAW_FILE),
        );

        const metadata = { enabled: true, chiroVersion: "1.0.0-test" };

        const poolOutcome = await runPool(
          [RAW_FILE],
          workDir,
          { mode: "preserve" },
          { metadata },
        );
        expect(poolOutcome.errored).toEqual([]);

        const processedDir = path.join(workDir, "processed");
        const poolChunks = (await readdir(processedDir)).sort();
        const poolBufs = await Promise.all(
          poolChunks.map((c) => readFile(path.join(processedDir, c))),
        );

        await rm(processedDir, { recursive: true, force: true });

        if (!SOX_BIN) throw new Error("sox not available");
        const soxResult = await runSoxBatch(
          SOX_BIN,
          [RAW_FILE],
          workDir,
          { mode: "preserve" },
          { metadata },
        );
        expect(soxResult.kind).toBe("completed");

        const soxChunks = (await readdir(processedDir)).sort();
        const soxBufs = await Promise.all(
          soxChunks.map((c) => readFile(path.join(processedDir, c))),
        );

        expect(soxChunks).toEqual(poolChunks);
        for (let i = 0; i < poolBufs.length; i++) {
          const p = poolBufs[i];
          const s = soxBufs[i];
          if (!p || !s) throw new Error("missing buffer");
          expect(Buffer.compare(s, p)).toBe(0);
        }
      },
    );

    it("with CHIRO_DISABLE_METADATA the chunk has no guan/wamd ancillaries", async () => {
      await copyFile(
        path.join(REAL_DIR, RAW_FILE),
        path.join(workDir, RAW_FILE),
      );

      const outcome = await runPool(
        [RAW_FILE],
        workDir,
        { mode: "preserve" },
        {
          metadata: { enabled: false, chiroVersion: "1.0.0-test" },
        },
      );
      expect(outcome.errored).toEqual([]);

      const chunks = (await readdir(path.join(workDir, "processed"))).sort();
      const firstChunk = chunks[0];
      if (firstChunk === undefined) throw new Error("no chunk produced");
      const firstChunkPath = path.join(workDir, "processed", firstChunk);
      const chunkBuf = await readFile(firstChunkPath);
      const parsed = parseRiffChunks(chunkBuf);

      expect(parsed.find((c) => c.id === "guan")).toBeUndefined();
      expect(parsed.find((c) => c.id === "wamd")).toBeUndefined();
      expect(parsed.find((c) => c.id === "data")).toBeDefined();
    });
  },
);
