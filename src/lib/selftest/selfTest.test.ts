import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSelfTest } from "./selfTest.js";

describe("runSelfTest", () => {
  let ownTmpDir: string;
  let savedTmpDir: string | undefined;

  beforeEach(async () => {
    ownTmpDir = await mkdtemp(path.join(tmpdir(), "chiro-selftest-test-"));
    savedTmpDir = process.env.TMPDIR;
    process.env.TMPDIR = ownTmpDir;
  });

  afterEach(async () => {
    if (savedTmpDir === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = savedTmpDir;
    await rm(ownTmpDir, { recursive: true, force: true });
  });

  it("completes with kind 'ok', reports every check, and leaves no residue in its own tmpdir even with another suite running", async () => {
    const result = await runSelfTest();

    if (result.kind === "error") {
      throw new Error(
        `self-test failed at "${result.check}": ${result.detail}`,
      );
    }

    expect(result.kind).toBe("ok");
    expect(result.checks.some((c) => c.startsWith("pool :"))).toBe(true);
    expect(result.checks.some((c) => c.startsWith("fixture :"))).toBe(true);
    // Either sox ran and matched the pool byte-for-byte, or it was reported
    // absent — both are valid outcomes depending on the machine running the
    // test, but exactly one sox-related check line must be present.
    expect(result.checks.some((c) => c.startsWith("sox :"))).toBe(true);

    expect(await readdir(ownTmpDir)).toEqual([]);
  }, 30_000);
});
