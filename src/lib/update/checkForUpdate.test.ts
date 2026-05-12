import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeCache } from "./cache.js";
import type { CheckOptions } from "./checkForUpdate.js";
import { checkForUpdate } from "./checkForUpdate.js";
import type { FetchResult } from "./fetchLatestVersion.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "chiro-update-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const cachePath = () => path.join(tmpDir, "update-check.json");

const TTL = 6 * 60 * 60 * 1000; // 6 h
const NOW = new Date("2026-05-12T10:00:00.000Z");
const FRESH_CHECKED_AT = new Date("2026-05-12T07:00:00.000Z"); // 3 h before NOW
const STALE_CHECKED_AT = new Date("2026-05-12T03:00:00.000Z"); // 7 h before NOW

const makeFetcher =
  (result: FetchResult) =>
  (_opts?: { signal?: AbortSignal }): Promise<FetchResult> =>
    Promise.resolve(result);

const baseOpts = (overrides?: Partial<CheckOptions>): CheckOptions => ({
  currentVersion: "v0.1.0",
  cachePath: cachePath(),
  ttlMs: TTL,
  now: NOW,
  ...overrides,
});

describe("checkForUpdate — fresh cache hit", () => {
  it("returns the available version when cache is fresh and remote > local", async () => {
    await writeCache(cachePath(), "v0.2.0", FRESH_CHECKED_AT);

    const fetcher = vi.fn(makeFetcher({ kind: "ok", tagName: "v0.2.0" }));
    const result = await checkForUpdate(baseOpts({ fetcher }));

    expect(result).toEqual({ availableVersion: "v0.2.0" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns null when cache is fresh and cached tag equals current version", async () => {
    await writeCache(cachePath(), "v0.1.0", FRESH_CHECKED_AT);

    const fetcher = vi.fn(makeFetcher({ kind: "ok", tagName: "v0.1.0" }));
    const result = await checkForUpdate(baseOpts({ fetcher }));

    expect(result).toEqual({ availableVersion: null });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns null when cache is fresh and cached tag is older than current version", async () => {
    await writeCache(cachePath(), "v0.0.9", FRESH_CHECKED_AT);

    const fetcher = vi.fn(makeFetcher({ kind: "ok", tagName: "v0.0.9" }));
    const result = await checkForUpdate(baseOpts({ fetcher }));

    expect(result).toEqual({ availableVersion: null });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns null when the cached tag is not a valid version string", async () => {
    // Exercises the isRemoteNewer(remote === null) branch
    await writeCache(cachePath(), "not-a-version", FRESH_CHECKED_AT);

    const fetcher = vi.fn(makeFetcher({ kind: "ok", tagName: "v0.1.0" }));
    const result = await checkForUpdate(baseOpts({ fetcher }));

    expect(result).toEqual({ availableVersion: null });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("checkForUpdate — stale cache triggers fetch", () => {
  it("calls the fetcher when the cache is stale", async () => {
    await writeCache(cachePath(), "v0.1.0", STALE_CHECKED_AT);

    const fetcher = vi.fn(makeFetcher({ kind: "ok", tagName: "v0.2.0" }));
    const result = await checkForUpdate(baseOpts({ fetcher }));

    expect(fetcher).toHaveBeenCalledOnce();
    expect(result).toEqual({ availableVersion: "v0.2.0" });
  });

  it("writes the new tag to cache after a successful fetch on stale cache", async () => {
    await writeCache(cachePath(), "v0.1.0", STALE_CHECKED_AT);

    const fetcher = vi.fn(makeFetcher({ kind: "ok", tagName: "v0.3.0" }));
    await checkForUpdate(baseOpts({ fetcher }));

    const { readCache } = await import("./cache.js");
    const entry = await readCache(cachePath());
    expect(entry?.latestTag).toBe("v0.3.0");
  });
});

describe("checkForUpdate — no cache triggers fetch", () => {
  it("calls the fetcher when there is no cache file", async () => {
    const fetcher = vi.fn(makeFetcher({ kind: "ok", tagName: "v0.2.0" }));
    const result = await checkForUpdate(baseOpts({ fetcher }));

    expect(fetcher).toHaveBeenCalledOnce();
    expect(result).toEqual({ availableVersion: "v0.2.0" });
  });

  it("writes cache after a successful fetch on missing cache", async () => {
    const fetcher = vi.fn(makeFetcher({ kind: "ok", tagName: "v0.2.0" }));
    await checkForUpdate(baseOpts({ fetcher }));

    const { readCache } = await import("./cache.js");
    const entry = await readCache(cachePath());
    expect(entry?.latestTag).toBe("v0.2.0");
  });

  it("returns null when fetcher returns an error", async () => {
    const fetcher = vi.fn(makeFetcher({ kind: "error", code: "network" }));
    const result = await checkForUpdate(baseOpts({ fetcher }));

    expect(result).toEqual({ availableVersion: null });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("does not write cache when fetcher returns an error", async () => {
    const fetcher = vi.fn(makeFetcher({ kind: "error", code: "timeout" }));
    await checkForUpdate(baseOpts({ fetcher }));

    const { readCache } = await import("./cache.js");
    const entry = await readCache(cachePath());
    expect(entry).toBeNull();
  });
});

describe("checkForUpdate — currentVersion validation", () => {
  it("returns null without calling fetcher when currentVersion is invalid", async () => {
    const fetcher = vi.fn(makeFetcher({ kind: "ok", tagName: "v0.2.0" }));
    const result = await checkForUpdate(
      baseOpts({ currentVersion: "not-a-version", fetcher }),
    );

    expect(result).toEqual({ availableVersion: null });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns null without calling fetcher when currentVersion is empty", async () => {
    const fetcher = vi.fn(makeFetcher({ kind: "ok", tagName: "v0.2.0" }));
    const result = await checkForUpdate(
      baseOpts({ currentVersion: "", fetcher }),
    );

    expect(result).toEqual({ availableVersion: null });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("checkForUpdate — default fetcher (global fetch fallback)", () => {
  it("falls back to fetchLatestVersion when no fetcher is provided", async () => {
    const stubFetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ tag_name: "v0.2.0" })));
    vi.stubGlobal("fetch", stubFetch);

    try {
      const result = await checkForUpdate(
        baseOpts({ fetcher: undefined, currentVersion: "0.1.0" }),
      );
      expect(result).toEqual({ availableVersion: "v0.2.0" });
      expect(stubFetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("checkForUpdate — silent failure on unexpected errors", () => {
  it("returns null when the fetcher rejects unexpectedly", async () => {
    const fetcher = vi.fn(
      (_opts?: { signal?: AbortSignal }): Promise<FetchResult> =>
        Promise.reject(new Error("unexpected")),
    );

    const result = await checkForUpdate(baseOpts({ fetcher }));
    expect(result).toEqual({ availableVersion: null });
  });
});

describe("checkForUpdate — comparison correctness after fetch", () => {
  it("returns null when the fetched tag equals current version", async () => {
    const fetcher = vi.fn(makeFetcher({ kind: "ok", tagName: "v0.1.0" }));
    const result = await checkForUpdate(baseOpts({ fetcher }));

    expect(result).toEqual({ availableVersion: null });
  });

  it("returns null when the fetched tag is older than current version", async () => {
    const fetcher = vi.fn(makeFetcher({ kind: "ok", tagName: "v0.0.9" }));
    const result = await checkForUpdate(baseOpts({ fetcher }));

    expect(result).toEqual({ availableVersion: null });
  });

  it("returns the tag when the fetched tag is a pre-release below current stable", async () => {
    // v0.1.0-rc.1 < v0.1.0 — no update available
    const fetcher = vi.fn(makeFetcher({ kind: "ok", tagName: "v0.1.0-rc.1" }));
    const result = await checkForUpdate(baseOpts({ fetcher }));

    expect(result).toEqual({ availableVersion: null });
  });
});
