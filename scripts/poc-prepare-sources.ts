import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { WaveFile } from "wavefile";
import { POC_ROOT, SOURCES, SOURCES_DIR } from "./poc-shared.js";

const writeRampWav = (
  filename: string,
  channels: number,
  sampleRate: number,
  bitDepth: "16" | "24",
  durationSeconds: number,
): void => {
  const sampleCount = Math.floor(sampleRate * durationSeconds);
  const ArrayCtor = bitDepth === "16" ? Int16Array : Int32Array;
  const maxValue = bitDepth === "16" ? 32768 : 8388608;
  const halfMax = maxValue / 2;
  const channelData: (Int16Array | Int32Array)[] = [];
  for (let c = 0; c < channels; c++) {
    const data = new ArrayCtor(sampleCount);
    const factor = c + 1;
    for (let i = 0; i < sampleCount; i++) {
      data[i] = ((i * factor) % maxValue) - halfMax;
    }
    channelData.push(data);
  }
  const wav = new WaveFile();
  if (channels === 1) {
    const ch0 = channelData[0];
    if (!ch0) throw new Error("no channel data");
    wav.fromScratch(1, sampleRate, bitDepth, ch0);
  } else {
    wav.fromScratch(channels, sampleRate, bitDepth, channelData);
  }
  writeFileSync(path.join(SOURCES_DIR, filename), wav.toBuffer());
};

rmSync(POC_ROOT, { recursive: true, force: true });
mkdirSync(SOURCES_DIR, { recursive: true });

for (const spec of SOURCES) {
  const targetPath = path.join(SOURCES_DIR, spec.filename);
  if (spec.copyFrom) {
    copyFileSync(spec.copyFrom, targetPath);
  } else {
    writeRampWav(
      spec.filename,
      spec.channels,
      spec.sampleRate,
      spec.bitDepth,
      spec.durationSeconds,
    );
  }
  console.log(`✓ ${spec.key.padEnd(22)} ${spec.filename}  — ${spec.description}`);
}
console.log(`\nSources ready in ${SOURCES_DIR}`);
