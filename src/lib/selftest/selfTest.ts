import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { WaveFile } from "wavefile";
import { buildChunkName, buildOutDir } from "../audio/batchPlan.js";
import { processWavFiles } from "../audio/processWavFiles.js";
import { detectSox } from "../audio/detectSox.js";
import { CHIRO_VERSION } from "../../version.js";

export type SelfTestResult =
  | { kind: "ok"; checks: string[] }
  | { kind: "error"; check: string; detail: string };

// 60 s at 38400 Hz with CHUNK_OUTPUT_SECONDS = 50 always splits into exactly
// 2 chunks (50 s + 10 s) — deterministic regardless of the constant's exact
// value, as long as it stays in (30, 60).
const FIXTURE_SAMPLE_RATE = 38400;
const FIXTURE_DURATION_SECONDS = 60;
const FIXTURE_BIT_DEPTH = "16";
// Parseable by parseSourceTimestamp so the GUANO/wamd builders are exercised.
const FIXTURE_FILENAME = "PaRecPR0000001_20260101_000000.wav";
const EXPECTED_CHUNK_COUNT = 2;
const RIFF_MAGIC = "RIFF";
const SAMPLE_RATE_HEADER_OFFSET = 24;
const MIN_VALID_WAV_BYTES = 44;

// Not lib/errors/describeError: that one prefers the error *code* for UI
// mapping; here the free-form message is the useful diagnostic.
const formatDetail = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

// Deterministic ramp — no Math.random, so the fixture (and any downstream
// hash comparison) is reproducible across runs and across the two engines.
const buildFixtureSamples = (): Int16Array => {
  const sampleCount = FIXTURE_SAMPLE_RATE * FIXTURE_DURATION_SECONDS;
  const samples = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = (i % 32768) - 16384;
  }
  return samples;
};

const writeFixtureWav = async (filePath: string): Promise<void> => {
  const wav = new WaveFile();
  wav.fromScratch(
    1,
    FIXTURE_SAMPLE_RATE,
    FIXTURE_BIT_DEPTH,
    buildFixtureSamples(),
  );
  await writeFile(filePath, wav.toBuffer());
};

const chunkPathFor = (
  outDir: string,
  baseName: string,
  chunkIndex: number,
): string => path.join(outDir, buildChunkName(baseName, chunkIndex));

type ChunkVerification =
  { kind: "ok"; hashes: string[] } | { kind: "error"; detail: string };

// Validates each expected chunk file (RIFF magic, minimum size, output
// sample rate) and returns their SHA-256 hashes for cross-engine comparison.
const verifyChunks = async (
  outDir: string,
  baseName: string,
): Promise<ChunkVerification> => {
  const hashes: string[] = [];

  for (let i = 0; i < EXPECTED_CHUNK_COUNT; i++) {
    const chunkPath = chunkPathFor(outDir, baseName, i);
    let buf: Buffer;
    try {
      buf = await readFile(chunkPath);
    } catch (err) {
      return {
        kind: "error",
        detail: `chunk manquant (${chunkPath}) : ${formatDetail(err)}`,
      };
    }

    if (buf.byteLength <= MIN_VALID_WAV_BYTES) {
      return {
        kind: "error",
        detail: `chunk trop petit (${String(buf.byteLength)} octets) : ${chunkPath}`,
      };
    }

    if (buf.subarray(0, 4).toString("ascii") !== RIFF_MAGIC) {
      return { kind: "error", detail: `magic RIFF invalide : ${chunkPath}` };
    }

    const sampleRate = buf.readUInt32LE(SAMPLE_RATE_HEADER_OFFSET);
    if (sampleRate !== FIXTURE_SAMPLE_RATE) {
      return {
        kind: "error",
        detail: `sample rate inattendu (${String(sampleRate)}) : ${chunkPath}`,
      };
    }

    hashes.push(createHash("sha256").update(buf).digest("hex"));
  }

  return { kind: "ok", hashes };
};

type StepResult =
  | { kind: "ok"; check: string }
  | { kind: "error"; check: string; detail: string };

type PoolStepResult =
  | { kind: "ok"; check: string; hashes: string[] }
  | { kind: "error"; check: string; detail: string };

const runPoolStep = async (
  dir: string,
  outDir: string,
  baseName: string,
): Promise<PoolStepResult> => {
  const outcome = await processWavFiles(
    [FIXTURE_FILENAME],
    dir,
    { mode: "preserve" },
    { metadata: { enabled: true, chiroVersion: CHIRO_VERSION } },
  );

  if (outcome.errored.length > 0) {
    return {
      kind: "error",
      check: "pool",
      detail: `erreurs : ${JSON.stringify(outcome.errored)}`,
    };
  }
  if (outcome.processed.length !== 1) {
    return {
      kind: "error",
      check: "pool",
      detail: `processed.length = ${String(outcome.processed.length)}`,
    };
  }
  const processed = outcome.processed[0];
  if (processed?.chunkCount !== EXPECTED_CHUNK_COUNT) {
    return {
      kind: "error",
      check: "pool",
      detail: `chunkCount = ${String(processed?.chunkCount)}, attendu ${String(EXPECTED_CHUNK_COUNT)}`,
    };
  }

  const verification = await verifyChunks(outDir, baseName);
  if (verification.kind === "error") {
    return { kind: "error", check: "pool", detail: verification.detail };
  }

  return {
    kind: "ok",
    check: `pool : ${String(EXPECTED_CHUNK_COUNT)} chunks valides`,
    hashes: verification.hashes,
  };
};

const runSoxStep = async (
  dir: string,
  outDir: string,
  baseName: string,
  binPath: string,
  poolHashes: string[],
): Promise<StepResult> => {
  await rm(outDir, { recursive: true, force: true }).catch(() => undefined);

  const outcome = await processWavFiles(
    [FIXTURE_FILENAME],
    dir,
    { mode: "preserve" },
    {
      metadata: { enabled: true, chiroVersion: CHIRO_VERSION },
      sox: { binPath },
    },
  );

  if (outcome.errored.length > 0) {
    return {
      kind: "error",
      check: "sox",
      detail: `erreurs : ${JSON.stringify(outcome.errored)}`,
    };
  }
  if (outcome.engine !== "sox") {
    return {
      kind: "error",
      check: "sox",
      detail: `retombé sur le moteur ${outcome.engine} (fallback silencieux)`,
    };
  }
  if (outcome.processed.length !== 1) {
    return {
      kind: "error",
      check: "sox",
      detail: `processed.length = ${String(outcome.processed.length)}`,
    };
  }

  const verification = await verifyChunks(outDir, baseName);
  if (verification.kind === "error") {
    return { kind: "error", check: "sox", detail: verification.detail };
  }

  const identical =
    verification.hashes.length === poolHashes.length &&
    verification.hashes.every((hash, i) => hash === poolHashes[i]);
  if (!identical) {
    return {
      kind: "error",
      check: "sox",
      detail: "chunks non byte-identiques à ceux du pool",
    };
  }

  return { kind: "ok", check: "sox : byte-identique au pool" };
};

const runChecks = async (dir: string): Promise<SelfTestResult> => {
  const checks: string[] = [];

  const fixturePath = path.join(dir, FIXTURE_FILENAME);
  try {
    await writeFixtureWav(fixturePath);
  } catch (err) {
    return { kind: "error", check: "fixture", detail: formatDetail(err) };
  }
  checks.push(
    `fixture : WAV ${String(FIXTURE_DURATION_SECONDS)} s généré (rampe déterministe)`,
  );

  const outDir = buildOutDir(dir);
  const baseName = path.parse(FIXTURE_FILENAME).name;

  const poolResult = await runPoolStep(dir, outDir, baseName);
  if (poolResult.kind === "error") {
    return {
      kind: "error",
      check: poolResult.check,
      detail: poolResult.detail,
    };
  }
  checks.push(poolResult.check);

  const soxAvailability = await detectSox();
  if (soxAvailability.kind === "absent") {
    checks.push("sox : absent, ignoré");
    return { kind: "ok", checks };
  }

  const soxResult = await runSoxStep(
    dir,
    outDir,
    baseName,
    soxAvailability.binPath,
    poolResult.hashes,
  );
  if (soxResult.kind === "error") {
    return { kind: "error", check: soxResult.check, detail: soxResult.detail };
  }
  checks.push(soxResult.check);

  return { kind: "ok", checks };
};

/**
 * Exercises the compiled binary end-to-end: worker bundle resolution in
 * `/$bunfs/` (via `processWavFiles` → the worker pool), a real split batch,
 * and — when sox is installed — the sox fast path plus its byte-identity
 * guarantee against the worker pool output.
 *
 * Never throws: every internal failure is reported as `{ kind: "error" }`.
 * The temp working directory is always cleaned up, even on failure.
 */
export const runSelfTest = async (): Promise<SelfTestResult> => {
  let dir: string;
  try {
    dir = await mkdtemp(path.join(tmpdir(), "chiro-selftest-"));
  } catch (err) {
    return { kind: "error", check: "mkdtemp", detail: formatDetail(err) };
  }

  try {
    return await runChecks(dir);
  } catch (err) {
    return { kind: "error", check: "unexpected", detail: formatDetail(err) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
};
