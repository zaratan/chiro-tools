/**
 * Dev utility: trims the committed AudioMoth fixtures to ~10 s of real-time
 * audio (~5 MB each instead of ~143 MB). Keeps the originals locally in
 * `test-data/Audiomoth/Audiomoth full/` (gitignored — out of LFS).
 *
 * Why: each integration test pulls the LFS fixtures. With 3 × 143 MB ≈ 430 MB
 * per CI run × 2 matrix legs ≈ 900 MB per PR. GitHub's free LFS quota is
 * 1 GB/month bandwidth — a handful of PRs blows it. Trimmed versions still
 * exercise every test assertion (sample rate, channels, bit depth, chunk
 * count > 0, byte-identical source, mid-run abort) without the bandwidth.
 *
 * Usage:
 *   bun scripts/trim-audiomoth-fixtures.ts
 *
 * Idempotent: if `Audiomoth full/<name>` already exists, the original move
 * is skipped (you've already run this before). Re-trims the brut/ versions
 * each time from the full/ copy as source of truth.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { WaveFile } from "wavefile";

const TEST_DATA = path.resolve(import.meta.dir, "..", "test-data");
const AUDIOMOTH_BRUT = path.join(TEST_DATA, "Audiomoth", "Audiomoth brut");
const AUDIOMOTH_FULL = path.join(TEST_DATA, "Audiomoth", "Audiomoth full");

const TRIM_SECONDS_REAL = 10;
const AUDIOMOTH_SAMPLE_RATE = 250000;
const TRIM_SAMPLES = TRIM_SECONDS_REAL * AUDIOMOTH_SAMPLE_RATE;

const FILENAMES = [
  "Car340581-2026-Pass2-Z5-20260507_210501T.WAV",
  "Car340581-2026-Pass2-Z5-20260507_212001T.WAV",
  "Car340581-2026-Pass2-Z5-20260508_042501T.WAV",
];

if (!existsSync(AUDIOMOTH_FULL)) {
  mkdirSync(AUDIOMOTH_FULL, { recursive: true });
}

const formatMB = (bytes: number): string =>
  `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

for (const name of FILENAMES) {
  const brutPath = path.join(AUDIOMOTH_BRUT, name);
  const fullPath = path.join(AUDIOMOTH_FULL, name);

  console.log(`\n${name}`);

  // 1. Back up the original to `Audiomoth full/` if not already there.
  if (!existsSync(fullPath)) {
    copyFileSync(brutPath, fullPath);
    console.log(`  ✓ Original backed up to "Audiomoth full/"`);
  } else {
    console.log(
      `  ℹ Original already in "Audiomoth full/" — re-trimming from there`,
    );
  }

  // 2. Read the full version (source of truth — survives multiple runs).
  const sourceBuffer = readFileSync(fullPath);
  const sourceSize = sourceBuffer.length;

  const wav = new WaveFile(sourceBuffer);
  const fmt = wav.fmt as { sampleRate: number; numChannels: number };
  if (fmt.sampleRate !== AUDIOMOTH_SAMPLE_RATE) {
    console.error(
      `  ✗ Unexpected sample rate ${fmt.sampleRate.toString()} — expected ${AUDIOMOTH_SAMPLE_RATE.toString()}`,
    );
    continue;
  }
  if (fmt.numChannels !== 1) {
    console.error(`  ✗ Unexpected channel count ${fmt.numChannels.toString()}`);
    continue;
  }

  const samples = wav.getSamples(false, Int16Array) as unknown as
    | Int16Array
    | Int16Array[];
  const channelData: Int16Array = Array.isArray(samples)
    ? (samples[0] as Int16Array)
    : (samples as Int16Array);

  const trimmedSamples = channelData.subarray(0, TRIM_SAMPLES);

  // 3. Write a fresh WAV at the original path with the trimmed samples.
  // wavefile drops the LIST/INFO chunk on fromScratch — aligned with what
  // Kaleidoscope produces. The tests don't assert LIST preservation on
  // the source, only that the run does not crash on LIST-bearing input.
  const trimmed = new WaveFile();
  trimmed.fromScratch(1, AUDIOMOTH_SAMPLE_RATE, "16", trimmedSamples);
  const trimmedBuffer = trimmed.toBuffer();
  writeFileSync(brutPath, trimmedBuffer);

  console.log(
    `  ✓ Trimmed: ${formatMB(sourceSize)} → ${formatMB(trimmedBuffer.length)} (${trimmedSamples.length.toString()} samples, ${TRIM_SECONDS_REAL.toString()} s of real audio)`,
  );
}

console.log(
  `\nDone. Originals preserved in:\n  ${AUDIOMOTH_FULL}\n\nAdd this to .gitignore to keep them out of LFS:\n  test-data/Audiomoth/Audiomoth full/\n`,
);
