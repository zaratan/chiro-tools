import { readFileSync } from "node:fs";
import path from "node:path";
import {
  FFMPEG_DIR,
  SOX_DIR,
  WAVEFILE_DIR,
  type ChunkManifestEntry,
  type Manifest,
} from "./poc-shared.js";

type DiffCategory = "MATCH" | "HEADER_BENIGN" | "HEADER_FATAL" | "SAMPLES";

const HEADER_FATAL_RANGES: { name: string; offset: number; length: number }[] =
  [
    { name: "audioFormat", offset: 20, length: 2 },
    { name: "channels", offset: 22, length: 2 },
    { name: "sampleRate", offset: 24, length: 4 },
    { name: "byteRate", offset: 28, length: 4 },
    { name: "blockAlign", offset: 32, length: 2 },
    { name: "bitsPerSample", offset: 34, length: 2 },
  ];

const loadManifest = (dir: string): Manifest =>
  JSON.parse(
    readFileSync(path.join(dir, "manifest.json"), "utf8"),
  ) as Manifest;

const findDataOffset = (buf: Buffer): number => {
  for (let i = 12; i < Math.min(buf.byteLength - 8, 4096); i++) {
    if (
      buf[i] === 0x64 &&
      buf[i + 1] === 0x61 &&
      buf[i + 2] === 0x74 &&
      buf[i + 3] === 0x61
    ) {
      return i + 8;
    }
  }
  return -1;
};

const compareEntry = (
  goldenPath: string,
  candPath: string,
): {
  category: DiffCategory;
  firstDiffOffset: number;
  details: string;
} => {
  const a = readFileSync(goldenPath);
  const b = readFileSync(candPath);
  if (a.byteLength === b.byteLength && a.equals(b)) {
    return { category: "MATCH", firstDiffOffset: -1, details: "" };
  }
  const minLen = Math.min(a.byteLength, b.byteLength);
  let firstDiff = -1;
  for (let i = 0; i < minLen; i++) {
    if (a[i] !== b[i]) {
      firstDiff = i;
      break;
    }
  }
  if (firstDiff === -1) firstDiff = minLen;

  const goldenDataOffset = findDataOffset(a);
  const candDataOffset = findDataOffset(b);

  const isFatalField = HEADER_FATAL_RANGES.some(
    (r) => firstDiff >= r.offset && firstDiff < r.offset + r.length,
  );

  let category: DiffCategory;
  if (isFatalField) category = "HEADER_FATAL";
  else if (
    goldenDataOffset > 0 &&
    candDataOffset > 0 &&
    firstDiff < Math.min(goldenDataOffset, candDataOffset)
  )
    category = "HEADER_BENIGN";
  else if (firstDiff < 44) category = "HEADER_BENIGN";
  else category = "SAMPLES";

  const sliceStart = Math.max(0, firstDiff - 4);
  const sliceEndA = Math.min(a.byteLength, firstDiff + 12);
  const sliceEndB = Math.min(b.byteLength, firstDiff + 12);
  const aHex = a.subarray(sliceStart, sliceEndA).toString("hex");
  const bHex = b.subarray(sliceStart, sliceEndB).toString("hex");
  const details = `off=${firstDiff} sizes=${a.byteLength}/${b.byteLength} dataAt=${goldenDataOffset}/${candDataOffset} | golden ${aHex} | cand ${bHex}`;
  return { category, firstDiffOffset: firstDiff, details };
};

const groupBySource = (
  m: Manifest,
): Map<string, ChunkManifestEntry[]> => {
  const out = new Map<string, ChunkManifestEntry[]>();
  for (const e of m.entries) {
    let list = out.get(e.source);
    if (!list) {
      list = [];
      out.set(e.source, list);
    }
    list.push(e);
  }
  return out;
};

const compareTo = (
  goldenDir: string,
  goldenManifest: Manifest,
  candDir: string,
  candManifest: Manifest,
): { totalMatch: number; totalChunks: number; firstFailures: string[] } => {
  const goldenBy = groupBySource(goldenManifest);
  const candBy = groupBySource(candManifest);

  console.log(`\n=== WAVEFILE vs ${candManifest.pipeline.toUpperCase()} ===`);
  console.log(
    `  golden wall=${goldenManifest.wallMs}ms (split=${goldenManifest.splitMs}, io+hash=${goldenManifest.ioMs}, cpu=${goldenManifest.cpuUserMs}ms)`,
  );
  console.log(
    `  cand   wall=${candManifest.wallMs}ms (spawn=${candManifest.splitMs}, rewrite=${candManifest.rewriteMs}, io+hash=${candManifest.ioMs}, cpu=${candManifest.cpuUserMs}ms)`,
  );

  let totalMatch = 0;
  let totalChunks = 0;
  const allFailures: string[] = [];

  for (const [source, goldenChunks] of goldenBy) {
    const candChunks = candBy.get(source) ?? [];
    const counts: Record<DiffCategory, number> = {
      MATCH: 0,
      HEADER_BENIGN: 0,
      HEADER_FATAL: 0,
      SAMPLES: 0,
    };
    const sourceFailures: string[] = [];
    const max = Math.max(goldenChunks.length, candChunks.length);
    for (let i = 0; i < max; i++) {
      const g = goldenChunks[i];
      const c = candChunks[i];
      totalChunks += 1;
      if (!g || !c) {
        counts.HEADER_FATAL += 1;
        sourceFailures.push(
          `  chunk ${i}: missing (golden=${g ? "y" : "n"}, cand=${c ? "y" : "n"})`,
        );
        continue;
      }
      const sourceBase = path.basename(source, ".wav");
      const r = compareEntry(
        path.join(goldenDir, sourceBase, g.chunk),
        path.join(candDir, sourceBase, c.chunk),
      );
      counts[r.category] += 1;
      if (r.category === "MATCH") totalMatch += 1;
      else if (sourceFailures.length < 2) {
        sourceFailures.push(`  ${g.chunk} [${r.category}] ${r.details}`);
      }
    }
    const mark = counts.MATCH === goldenChunks.length ? "✅" : "❌";
    console.log(
      `  ${mark} ${source.padEnd(28)} ${goldenChunks.length} chunks → MATCH=${counts.MATCH} BENIGN=${counts.HEADER_BENIGN} FATAL=${counts.HEADER_FATAL} SAMPLES=${counts.SAMPLES}`,
    );
    for (const f of sourceFailures) {
      console.log(f);
      allFailures.push(f);
    }
  }
  console.log(`  TOTAL: ${totalMatch}/${totalChunks} MATCH`);
  return { totalMatch, totalChunks, firstFailures: allFailures };
};

const golden = loadManifest(WAVEFILE_DIR);
const ffmpeg = loadManifest(FFMPEG_DIR);
const sox = loadManifest(SOX_DIR);

console.log(
  `Golden: wavefile, ${golden.entries.length} chunks, wall ${golden.wallMs} ms`,
);

const ffR = compareTo(WAVEFILE_DIR, golden, FFMPEG_DIR, ffmpeg);
const soxR = compareTo(WAVEFILE_DIR, golden, SOX_DIR, sox);

console.log("\n=== SUMMARY ===");
console.log(
  `ffmpeg: ${ffR.totalMatch}/${ffR.totalChunks} MATCH — wall ${ffmpeg.wallMs} ms (${((golden.wallMs / ffmpeg.wallMs) * 1).toFixed(1)}× faster than wavefile)`,
);
console.log(
  `sox:    ${soxR.totalMatch}/${soxR.totalChunks} MATCH — wall ${sox.wallMs} ms (${((golden.wallMs / sox.wallMs) * 1).toFixed(1)}× faster than wavefile)`,
);
