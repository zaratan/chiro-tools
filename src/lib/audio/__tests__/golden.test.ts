import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run as runPool } from "../splitWorkerPool.js";
import { runSoxBatch } from "../soxFastPath.js";
import { makeRampWav } from "./fixtures.js";

const sha256 = (data: Buffer | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

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

const collectChunkHashes = async (
  processedDir: string,
): Promise<Map<string, string>> => {
  const result = new Map<string, string>();
  let entries: string[];
  try {
    entries = await readdir(processedDir);
  } catch {
    return result;
  }
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".wav")) continue;
    const buf = await readFile(path.join(processedDir, entry));
    result.set(entry, sha256(buf));
  }
  return result;
};

describe("golden — worker pool A vs sox B", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-golden-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // Helpers to set up and compare two pipelines
  const runAndCollect = async (
    mode: "preserve" | "expand-10x",
    fileName: string,
    pipeline: "pool" | "sox",
    outSuffix: string,
  ): Promise<Map<string, string>> => {
    const workDir = path.join(tmpDir, outSuffix + "-src");
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(workDir, { recursive: true }),
    );

    // Copy source to work dir
    const srcBuf = await readFile(path.join(tmpDir, "sources", fileName));
    await writeFile(path.join(workDir, fileName), srcBuf);

    if (pipeline === "pool") {
      await runPool([fileName], workDir, { mode });
    } else {
      if (!SOX_BIN) throw new Error("sox not available");
      const result = await runSoxBatch(SOX_BIN, [fileName], workDir, {
        mode,
      });
      if (result.kind !== "completed") {
        throw new Error(
          `sox pipeline failed: ${result.kind === "fallback" ? result.reason : "unknown"}`,
        );
      }
    }

    return collectChunkHashes(path.join(workDir, "processed"));
  };

  const setupSource = async (
    fileName: string,
    data: Uint8Array,
  ): Promise<void> => {
    const srcDir = path.join(tmpDir, "sources");
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(srcDir, { recursive: true }),
    );
    await writeFile(path.join(srcDir, fileName), data);
  };

  it("preserve mode: synthetic 16-bit mono — pool produces consistent SHA256", async () => {
    const wav = makeRampWav({
      channels: 1,
      sampleRate: 48000,
      bitDepth: "16",
      durationSeconds: 11,
    });
    await setupSource("mono16-golden.wav", wav);

    const hashes1 = await runAndCollect(
      "preserve",
      "mono16-golden.wav",
      "pool",
      "run1",
    );
    const hashes2 = await runAndCollect(
      "preserve",
      "mono16-golden.wav",
      "pool",
      "run2",
    );

    expect(hashes1.size).toBeGreaterThan(0);
    for (const [key, hash1] of hashes1) {
      expect(hashes2.get(key)).toBe(hash1);
    }
  });

  it("expand-10x mode: synthetic 16-bit mono 250kHz — pool consistent", async () => {
    const wav = makeRampWav({
      channels: 1,
      sampleRate: 250000,
      bitDepth: "16",
      durationSeconds: 1,
    });
    await setupSource("audiomoth-golden.wav", wav);

    const hashes1 = await runAndCollect(
      "expand-10x",
      "audiomoth-golden.wav",
      "pool",
      "run1",
    );
    const hashes2 = await runAndCollect(
      "expand-10x",
      "audiomoth-golden.wav",
      "pool",
      "run2",
    );

    expect(hashes1.size).toBeGreaterThan(0);
    for (const [key, hash1] of hashes1) {
      expect(hashes2.get(key)).toBe(hash1);
    }
  });

  it("preserve mode: synthetic 24-bit stereo — pool consistent", async () => {
    const wav = makeRampWav({
      channels: 2,
      sampleRate: 48000,
      bitDepth: "24",
      durationSeconds: 6,
    });
    await setupSource("stereo24-golden.wav", wav);

    const hashes1 = await runAndCollect(
      "preserve",
      "stereo24-golden.wav",
      "pool",
      "run1",
    );
    const hashes2 = await runAndCollect(
      "preserve",
      "stereo24-golden.wav",
      "pool",
      "run2",
    );

    expect(hashes1.size).toBeGreaterThan(0);
    for (const [key, hash1] of hashes1) {
      expect(hashes2.get(key)).toBe(hash1);
    }
  });

  describe.skipIf(!soxAvailable)("A vs B bit-exact (sox available)", () => {
    it("preserve mode: sox output matches worker pool output bit-exactly", async () => {
      const wav = makeRampWav({
        channels: 1,
        sampleRate: 48000,
        bitDepth: "16",
        durationSeconds: 11,
      });
      await setupSource("mono16-axb.wav", wav);

      const poolHashes = await runAndCollect(
        "preserve",
        "mono16-axb.wav",
        "pool",
        "pool-out",
      );
      const soxHashes = await runAndCollect(
        "preserve",
        "mono16-axb.wav",
        "sox",
        "sox-out",
      );

      expect(poolHashes.size).toBeGreaterThan(0);
      expect(soxHashes.size).toBe(poolHashes.size);

      for (const [key, poolHash] of poolHashes) {
        expect(soxHashes.get(key)).toBe(poolHash);
      }
    }, 30_000);

    it("expand-10x mode: sox output matches worker pool output bit-exactly", async () => {
      const wav = makeRampWav({
        channels: 1,
        sampleRate: 250000,
        bitDepth: "16",
        durationSeconds: 1,
      });
      await setupSource("audiomoth-axb.wav", wav);

      const poolHashes = await runAndCollect(
        "expand-10x",
        "audiomoth-axb.wav",
        "pool",
        "pool-out",
      );
      const soxHashes = await runAndCollect(
        "expand-10x",
        "audiomoth-axb.wav",
        "sox",
        "sox-out",
      );

      expect(poolHashes.size).toBeGreaterThan(0);
      expect(soxHashes.size).toBe(poolHashes.size);

      for (const [key, poolHash] of poolHashes) {
        expect(soxHashes.get(key)).toBe(poolHash);
      }
    }, 30_000);

    it("preserve mode: 24-bit stereo — sox matches pool bit-exactly", async () => {
      const wav = makeRampWav({
        channels: 2,
        sampleRate: 48000,
        bitDepth: "24",
        durationSeconds: 6,
      });
      await setupSource("stereo24-axb.wav", wav);

      const poolHashes = await runAndCollect(
        "preserve",
        "stereo24-axb.wav",
        "pool",
        "pool-out",
      );
      const soxHashes = await runAndCollect(
        "preserve",
        "stereo24-axb.wav",
        "sox",
        "sox-out",
      );

      expect(poolHashes.size).toBeGreaterThan(0);
      expect(soxHashes.size).toBe(poolHashes.size);

      for (const [key, poolHash] of poolHashes) {
        expect(soxHashes.get(key)).toBe(poolHash);
      }
    }, 30_000);
  });
});
