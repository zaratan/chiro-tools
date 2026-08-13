import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runSelfTest } from "./selfTest.js";

describe("runSelfTest", () => {
  it("completes with kind 'ok' and reports the pool check", async () => {
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
  }, 30_000);

  it("leaves no residue in the OS temp directory", async () => {
    const before = await readdir(tmpdir());

    const result = await runSelfTest();
    expect(result.kind).toBe("ok");

    const after = await readdir(tmpdir());
    const newEntries = after.filter((entry) => !before.includes(entry));
    const selfTestLeftovers = newEntries.filter((entry) =>
      entry.startsWith("chiro-selftest-"),
    );

    expect(selfTestLeftovers).toEqual([]);
  }, 30_000);
});
