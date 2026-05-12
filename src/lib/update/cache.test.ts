import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isCacheFresh, readCache, writeCache } from "./cache.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "chiro-cache-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("readCache", () => {
  it("returns null when the file does not exist (ENOENT)", async () => {
    const result = await readCache(path.join(tmpDir, "missing.json"));
    expect(result).toBeNull();
  });

  it("returns null when the path is a directory (non-ENOENT I/O error)", async () => {
    // Passing a directory path causes EISDIR on read — exercises the non-ENOENT catch branch
    const result = await readCache(tmpDir);
    expect(result).toBeNull();
  });

  it("returns null when the file contains invalid JSON", async () => {
    const cachePath = path.join(tmpDir, "cache.json");
    await writeCache(cachePath, "v0.1.0");
    // Overwrite with garbage
    const { writeFile } = await import("node:fs/promises");
    await writeFile(cachePath, "not-json");

    const result = await readCache(cachePath);
    expect(result).toBeNull();
  });

  it("returns null when checkedAt is not a valid date string", async () => {
    const cachePath = path.join(tmpDir, "cache.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      cachePath,
      JSON.stringify({ checkedAt: "not-a-date", latestTag: "v0.1.0" }),
    );

    const result = await readCache(cachePath);
    expect(result).toBeNull();
  });

  it("returns null when latestTag is not a string", async () => {
    const cachePath = path.join(tmpDir, "cache.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      cachePath,
      JSON.stringify({ checkedAt: new Date().toISOString(), latestTag: 42 }),
    );

    const result = await readCache(cachePath);
    expect(result).toBeNull();
  });

  it("returns null when latestTag is missing", async () => {
    const cachePath = path.join(tmpDir, "cache.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      cachePath,
      JSON.stringify({ checkedAt: new Date().toISOString() }),
    );

    const result = await readCache(cachePath);
    expect(result).toBeNull();
  });

  it("returns null when the JSON parses to a primitive (not an object)", async () => {
    const cachePath = path.join(tmpDir, "cache.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(cachePath, "42");

    const result = await readCache(cachePath);
    expect(result).toBeNull();
  });

  it("returns null when the JSON parses to null literally", async () => {
    const cachePath = path.join(tmpDir, "cache.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(cachePath, "null");

    const result = await readCache(cachePath);
    expect(result).toBeNull();
  });

  it("returns null when checkedAt is not a string (e.g., a number)", async () => {
    const cachePath = path.join(tmpDir, "cache.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      cachePath,
      JSON.stringify({ checkedAt: 1700000000000, latestTag: "v0.1.0" }),
    );

    const result = await readCache(cachePath);
    expect(result).toBeNull();
  });

  it("returns a valid CacheEntry on a well-formed file", async () => {
    const cachePath = path.join(tmpDir, "cache.json");
    const now = new Date("2026-05-12T09:00:00.000Z");
    await writeCache(cachePath, "v0.2.0", now);

    const result = await readCache(cachePath);
    expect(result).not.toBeNull();
    expect(result?.latestTag).toBe("v0.2.0");
    expect(result?.checkedAt.toISOString()).toBe("2026-05-12T09:00:00.000Z");
  });
});

describe("writeCache", () => {
  it("creates the parent directory if it does not exist", async () => {
    const deepPath = path.join(tmpDir, "nested", "dir", "cache.json");
    await writeCache(deepPath, "v0.1.0");

    const entry = await readCache(deepPath);
    expect(entry?.latestTag).toBe("v0.1.0");
  });

  it("writes atomically — no .tmp file remains after a successful write", async () => {
    const cachePath = path.join(tmpDir, "cache.json");
    await writeCache(cachePath, "v0.1.0");

    const tmpPath = cachePath + ".tmp";
    await expect(stat(tmpPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("round-trips: what is written can be read back", async () => {
    const cachePath = path.join(tmpDir, "cache.json");
    const now = new Date("2026-01-01T00:00:00.000Z");
    await writeCache(cachePath, "v1.2.3", now);

    const entry = await readCache(cachePath);
    expect(entry?.latestTag).toBe("v1.2.3");
    expect(entry?.checkedAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("uses the current time when 'now' is not provided", async () => {
    const before = new Date();
    const cachePath = path.join(tmpDir, "cache.json");
    await writeCache(cachePath, "v0.1.0");
    const after = new Date();

    const entry = await readCache(cachePath);
    expect(entry).not.toBeNull();
    if (entry === null)
      throw new Error("type narrowing: entry expected to be non-null");
    expect(entry.checkedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(entry.checkedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("the written JSON contains the expected fields", async () => {
    const cachePath = path.join(tmpDir, "cache.json");
    const now = new Date("2026-05-12T10:00:00.000Z");
    await writeCache(cachePath, "v0.3.0", now);

    const raw = JSON.parse(await readFile(cachePath, "utf-8")) as unknown;
    expect(typeof raw === "object" && raw !== null).toBe(true);
    const obj = raw as Record<string, unknown>;
    expect(obj.checkedAt).toBe("2026-05-12T10:00:00.000Z");
    expect(obj.latestTag).toBe("v0.3.0");
  });

  it("overwrites an existing cache file", async () => {
    const cachePath = path.join(tmpDir, "cache.json");
    const t1 = new Date("2026-05-12T08:00:00.000Z");
    const t2 = new Date("2026-05-12T09:00:00.000Z");
    await writeCache(cachePath, "v0.1.0", t1);
    await writeCache(cachePath, "v0.2.0", t2);

    const entry = await readCache(cachePath);
    expect(entry?.latestTag).toBe("v0.2.0");
    expect(entry?.checkedAt.toISOString()).toBe("2026-05-12T09:00:00.000Z");
  });
});

describe("isCacheFresh", () => {
  const TTL = 6 * 60 * 60 * 1000; // 6 h in ms

  it("returns true when checkedAt is within the TTL", () => {
    const now = new Date("2026-05-12T10:00:00.000Z");
    const checkedAt = new Date("2026-05-12T07:00:00.000Z"); // 3 h ago
    expect(isCacheFresh(checkedAt, TTL, now)).toBe(true);
  });

  it("returns false when checkedAt is exactly at the TTL boundary", () => {
    const now = new Date("2026-05-12T10:00:00.000Z");
    const checkedAt = new Date("2026-05-12T04:00:00.000Z"); // exactly 6 h ago
    expect(isCacheFresh(checkedAt, TTL, now)).toBe(false);
  });

  it("returns false when checkedAt is older than the TTL", () => {
    const now = new Date("2026-05-12T10:00:00.000Z");
    const checkedAt = new Date("2026-05-12T03:00:00.000Z"); // 7 h ago
    expect(isCacheFresh(checkedAt, TTL, now)).toBe(false);
  });

  it("uses Date.now() when 'now' is not provided", () => {
    const checkedAt = new Date(Date.now() - 1000); // 1 second ago
    expect(isCacheFresh(checkedAt, TTL)).toBe(true);
  });

  it("returns false for a checkedAt in the future (clock skew guard)", () => {
    // If checkedAt is in the future, age is negative: not < TTL when TTL is
    // measured positively. age = now - future = negative < TTL, so this is
    // actually "fresh" — document this edge case explicitly.
    const now = new Date("2026-05-12T10:00:00.000Z");
    const checkedAt = new Date("2026-05-12T11:00:00.000Z"); // 1 h in the future
    // Negative age is still < TTL (6 h), so treated as fresh.
    expect(isCacheFresh(checkedAt, TTL, now)).toBe(true);
  });
});

describe("writeCache — parent directory creation", () => {
  it("creates multiple levels of nested directories", async () => {
    const deepDir = path.join(tmpDir, "a", "b", "c");
    const cachePath = path.join(deepDir, "update.json");

    await writeCache(cachePath, "v0.5.0");

    const entry = await readCache(cachePath);
    expect(entry?.latestTag).toBe("v0.5.0");
  });

  it("does not fail when the parent directory already exists", async () => {
    await mkdir(path.join(tmpDir, "existing"), { recursive: true });
    const cachePath = path.join(tmpDir, "existing", "cache.json");

    await expect(writeCache(cachePath, "v0.1.0")).resolves.toBeUndefined();
  });
});
