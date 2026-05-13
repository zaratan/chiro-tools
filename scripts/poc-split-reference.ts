import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { splitWavFile } from "../src/lib/audio/splitWavFile.js";
import {
  CHUNK_SECONDS,
  SOURCES,
  SOURCES_DIR,
  WAVEFILE_DIR,
  sha256OfBuffer,
  type ChunkManifestEntry,
  type Manifest,
} from "./poc-shared.js";

const PAD = 3;

mkdirSync(WAVEFILE_DIR, { recursive: true });

const entries: ChunkManifestEntry[] = [];
const startWall = performance.now();
const startCpu = process.cpuUsage();
let splitMs = 0;
let ioMs = 0;

for (const spec of SOURCES) {
  const sourcePath = path.join(SOURCES_DIR, spec.filename);
  const buffer = readFileSync(sourcePath);
  const sourceBase = path.basename(spec.filename, ".wav");
  const outDir = path.join(WAVEFILE_DIR, sourceBase);
  mkdirSync(outDir, { recursive: true });

  let index = 0;
  const gen = splitWavFile(buffer, {
    mode: spec.mode,
    chunkSeconds: CHUNK_SECONDS,
  });
  while (true) {
    const splitT0 = performance.now();
    const next = gen.next();
    splitMs += performance.now() - splitT0;
    if (next.done) break;
    const yielded = next.value;
    if (yielded.kind === "error") {
      console.error(`  ✗ ${spec.key}: ${yielded.code}`);
      break;
    }
    if (yielded.kind === "abort") break;
    const ioT0 = performance.now();
    const chunkName = `${String(index).padStart(PAD, "0")}.wav`;
    const chunkPath = path.join(outDir, chunkName);
    writeFileSync(chunkPath, yielded.chunk.buffer);
    entries.push({
      source: spec.filename,
      chunk: chunkName,
      sha256: sha256OfBuffer(yielded.chunk.buffer),
      bytes: yielded.chunk.buffer.byteLength,
    });
    ioMs += performance.now() - ioT0;
    index += 1;
  }
  console.log(`  ✓ ${spec.key.padEnd(22)} ${index} chunks`);
}

const wallMs = performance.now() - startWall;
const cpu = process.cpuUsage(startCpu);
const manifest: Manifest = {
  pipeline: "wavefile",
  wallMs: Math.round(wallMs),
  cpuUserMs: Math.round(cpu.user / 1000),
  cpuSystemMs: Math.round(cpu.system / 1000),
  splitMs: Math.round(splitMs),
  rewriteMs: 0,
  ioMs: Math.round(ioMs),
  entries,
};
writeFileSync(
  path.join(WAVEFILE_DIR, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(
  `\n${entries.length} chunks total — wall ${wallMs.toFixed(0)} ms (split ${splitMs.toFixed(0)} ms, io+hash ${ioMs.toFixed(0)} ms), CPU user ${(cpu.user / 1000).toFixed(0)} ms`,
);
