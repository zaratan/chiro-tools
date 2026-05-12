/**
 * Dev utility: generates a few valid synthetic WAV files for manual testing
 * of the « Découper les enregistrements » flow. Called from `reset-demo.sh`.
 *
 * Usage: bun scripts/generate-demo-fixtures.ts <target-dir>
 *
 * Produces:
 *   - 2 Teensy-like files (38 400 Hz, ~2 s each) → test "preserve" mode
 *   - 2 AudioMoth-like files (250 000 Hz, ~1 s each) → test "expand-10x"
 *
 * Files use a deterministic sine wave so a manual recette in Audacity is
 * possible (you should hear a steady tone, or a slower one after TE).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { WaveFile } from "wavefile";

const targetDir = process.argv[2];
if (!targetDir) {
  console.error("usage: bun scripts/generate-demo-fixtures.ts <target-dir>");
  process.exit(1);
}

const writeSineWav = (
  filename: string,
  sampleRate: number,
  durationSec: number,
  frequencyHz: number,
): void => {
  const sampleCount = Math.floor(sampleRate * durationSec);
  const samples = new Int16Array(sampleCount);
  const amplitude = 16000;
  for (let i = 0; i < sampleCount; i++) {
    samples[i] = Math.round(
      amplitude * Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate),
    );
  }
  const wav = new WaveFile();
  wav.fromScratch(1, sampleRate, "16", samples);
  writeFileSync(path.join(targetDir, filename), wav.toBuffer());
};

// 10 raw Teensy-like recordings (already TE×10 at record time, 38 400 Hz).
// Each ~1 second so the process flow yields 0 full 5-s chunks + 1 tail —
// good for testing the partial-tail path. Sine frequency varies so a manual
// Audacity recette can distinguish chunks.
const teensyTimestamps = [
  "04",
  "09",
  "11",
  "18",
  "25",
  "35",
  "37",
  "40",
  "42",
  "45",
];
for (let i = 0; i < teensyTimestamps.length; i++) {
  const sec = teensyTimestamps[i];
  writeSineWav(
    `PaRecPR1925645_20260507_2100${sec}.wav`,
    38400,
    1,
    400 + i * 50, // 400 .. 850 Hz
  );
}

// 2 AudioMoth-like recordings (250 kHz full-spectrum). After TE×10 → 25 kHz
// output, 5 s chunks. 1 s real → 10 s expanded → 2 chunks. 3 s real → 6 chunks.
writeSineWav("20260507_220000T.WAV", 250000, 1, 30000); // 30 kHz ultrasonic call
writeSineWav("20260507_220100T.WAV", 250000, 3, 50000); // 50 kHz ultrasonic call

// 1 file already at the Vigie-Chiro format — exercises `skippedAlreadyPrefixed`
// in the rename flow. Made valid so the process flow can also handle it.
writeSineWav("Car040962-2026-Pass3-A1-historical.wav", 38400, 1, 1000);

// 1 uppercase .WAV — exercises `.WAV → .wav` normalization in the rename flow.
writeSineWav("OTHERSTEM_20260507.WAV", 38400, 1, 1200);

console.log(`✓ Synthetic WAVs written to ${targetDir}`);
