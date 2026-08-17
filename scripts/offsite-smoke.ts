/**
 * Smoke test — real `uploadArchive`, real Scaleway bucket.
 *
 * `pnpm check` never runs this (vitest's `include` only covers
 * `src/**\/*.test.ts`) — on purpose, this is the one thing in 10.A2 that is
 * allowed to touch the network. It drives `uploadArchive` on a throwaway
 * 50 MB file, prints every parsed progress tick plus the final result, then
 * deletes the object it created. This is what would have caught the D3
 * progress-contract bug before any screen existed to display it wrong.
 *
 * Usage:
 *   bun scripts/offsite-smoke.ts --remote chiro-coffre --bucket <bucket>
 */

import { randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, rmSync, writeSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { detectRclone } from "../src/lib/offsite/detectRclone.js";
import {
  nodeRcloneSpawn,
  uploadArchive,
} from "../src/lib/offsite/uploadArchive.js";
import { remoteStat } from "../src/lib/offsite/remoteStat.js";
import { buildRemoteObjectPath } from "../src/lib/offsite/remoteStat.js";

const FILE_MB = 50;
const WORK_DIR = "/tmp/chiro-offsite-smoke";

const parseArgs = () => {
  const args = process.argv.slice(2);
  const get = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  return { remote: get("remote"), bucket: get("bucket") };
};

const makeFile = (filePath: string, megabytes: number) => {
  const chunk = randomBytes(1024 * 1024);
  const fd = openSync(filePath, "w");
  for (let i = 0; i < megabytes; i++) writeSync(fd, chunk);
  closeSync(fd);
};

const main = async () => {
  const { remote, bucket } = parseArgs();
  if (!remote || !bucket) {
    console.error(
      "Usage: bun scripts/offsite-smoke.ts --remote <name> --bucket <bucket>",
    );
    process.exit(1);
  }

  const availability = detectRclone();
  if (availability.kind !== "available") {
    console.error(`rclone not usable: ${JSON.stringify(availability)}`);
    process.exit(1);
  }
  console.log(`rclone ${availability.version} at ${availability.binPath}`);

  const settings = { remote, bucket, prefix: "chiro-smoke" };
  const key = `smoke-${String(Date.now())}.bin`;

  const localPath = path.join(WORK_DIR, "smoke.bin");
  rmSync(WORK_DIR, { recursive: true, force: true });
  mkdirSync(WORK_DIR, { recursive: true });
  makeFile(localPath, FILE_MB);
  const localBytes = FILE_MB * 1024 * 1024;

  console.log(
    `Uploading ${String(localBytes)} bytes to ${buildRemoteObjectPath(settings, key)}`,
  );

  const start = performance.now();
  const result = await uploadArchive(
    { spawn: nodeRcloneSpawn, remoteStat },
    {
      rcloneBinPath: availability.binPath,
      platform: process.platform,
      settings,
      key,
      localPath,
      localBytes,
      onProgress: (bytesTransferred) => {
        const pct = ((bytesTransferred / localBytes) * 100).toFixed(1);
        console.log(`  tick: ${String(bytesTransferred)}/${String(localBytes)} (${pct}%)`);
      },
    },
  );
  const elapsedMs = performance.now() - start;

  console.log(`\nResult after ${elapsedMs.toFixed(0)} ms:`);
  console.log(JSON.stringify(result, null, 2));

  console.log("\nCleaning up remote object…");
  const del = spawnSync(availability.binPath, [
    "deletefile",
    buildRemoteObjectPath(settings, key),
  ]);
  if (del.status !== 0) {
    console.error(
      `Warning: cleanup failed (status ${String(del.status)}) — delete ${buildRemoteObjectPath(settings, key)} manually.`,
    );
  } else {
    console.log("Remote object deleted.");
  }

  rmSync(WORK_DIR, { recursive: true, force: true });

  process.exit(result.kind === "ok" ? 0 : 1);
};

await main();
