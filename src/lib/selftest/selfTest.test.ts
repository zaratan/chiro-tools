import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runSelfTest } from "./selfTest.js";

describe("runSelfTest", () => {
  it("completes with kind 'ok', reports every check, and leaves no residue", async () => {
    // Residue is asserted here rather than in its own test: the separate one
    // re-ran the whole self-test (3 s) for a `readdir` diff, and asserted on
    // `os.tmpdir()` — a *shared* directory, so any parallel process running a
    // self-test failed it. That was a real flake, not a real finding.
    const before = new Set(await readdir(tmpdir()));

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

    const leftovers = (await readdir(tmpdir())).filter(
      (entry) => entry.startsWith("chiro-selftest-") && !before.has(entry),
    );
    expect(leftovers).toEqual([]);
  }, 30_000);
});
