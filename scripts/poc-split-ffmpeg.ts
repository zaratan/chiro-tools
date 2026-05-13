import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  CHUNK_SECONDS,
  FFMPEG_DIR,
  SOURCES,
  SOURCES_DIR,
  rewriteHeaderToStandardPcm,
  sha256OfBuffer,
  type ChunkManifestEntry,
  type Manifest,
} from "./poc-shared.js";

const PAD = 3;

rmSync(FFMPEG_DIR, { recursive: true, force: true });
mkdirSync(FFMPEG_DIR, { recursive: true });

const entries: ChunkManifestEntry[] = [];
const startWall = performance.now();
const startCpu = process.cpuUsage();
let splitMs = 0;
let rewriteMs = 0;
let ioMs = 0;

for (const spec of SOURCES) {
  const sourcePath = path.join(SOURCES_DIR, spec.filename);
  const sourceBase = path.basename(spec.filename, ".wav");
  const outDir = path.join(FFMPEG_DIR, sourceBase);
  mkdirSync(outDir, { recursive: true });

  const segmentPattern = path.join(outDir, "raw_%05d.wav");
  const segmentSeconds =
    spec.mode === "expand-10x" ? CHUNK_SECONDS / 10 : CHUNK_SECONDS;
  const splitT0 = performance.now();
  const result = spawnSync(
    "ffmpeg",
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      sourcePath,
      "-f",
      "segment",
      "-segment_time",
      String(segmentSeconds),
      "-c",
      "copy",
      segmentPattern,
    ],
    { encoding: "utf8" },
  );
  splitMs += performance.now() - splitT0;

  if (result.status !== 0) {
    console.error(`  ✗ ${spec.key}: ffmpeg exit ${result.status}`);
    console.error(result.stderr);
    continue;
  }

  const files = readdirSync(outDir)
    .filter((f) => f.startsWith("raw_") && f.endsWith(".wav"))
    .sort();

  let index = 0;
  for (const f of files) {
    const raw = path.join(outDir, f);
    const rewriteT0 = performance.now();
    rewriteHeaderToStandardPcm(raw, spec.mode === "expand-10x");
    rewriteMs += performance.now() - rewriteT0;
    const ioT0 = performance.now();
    const chunkName = `${String(index).padStart(PAD, "0")}.wav`;
    const final = path.join(outDir, chunkName);
    renameSync(raw, final);
    const buf = readFileSync(final);
    entries.push({
      source: spec.filename,
      chunk: chunkName,
      sha256: sha256OfBuffer(buf),
      bytes: buf.byteLength,
    });
    ioMs += performance.now() - ioT0;
    index += 1;
  }
  console.log(`  ✓ ${spec.key.padEnd(22)} ${index} chunks`);
}

const wallMs = performance.now() - startWall;
const cpu = process.cpuUsage(startCpu);
const manifest: Manifest = {
  pipeline: "ffmpeg",
  wallMs: Math.round(wallMs),
  cpuUserMs: Math.round(cpu.user / 1000),
  cpuSystemMs: Math.round(cpu.system / 1000),
  splitMs: Math.round(splitMs),
  rewriteMs: Math.round(rewriteMs),
  ioMs: Math.round(ioMs),
  entries,
};
writeFileSync(
  path.join(FFMPEG_DIR, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(
  `\n${entries.length} chunks total — wall ${wallMs.toFixed(0)} ms (spawn ${splitMs.toFixed(0)} ms, rewrite ${rewriteMs.toFixed(0)} ms, io+hash ${ioMs.toFixed(0)} ms), CPU user ${(cpu.user / 1000).toFixed(0)} ms`,
);
