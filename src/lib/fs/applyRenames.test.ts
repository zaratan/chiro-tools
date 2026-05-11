import {
  copyFile as realCopyFile,
  mkdtemp,
  readdir,
  rename as realRename,
  rm,
  unlink as realUnlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenamePlan } from "../../types.js";
import { applyRenames, type FsLike } from "./applyRenames.js";

const emptyPlan = (overrides: Partial<RenamePlan> = {}): RenamePlan => ({
  operations: [],
  skippedAlreadyPrefixed: [],
  skippedCollision: [],
  ...overrides,
});

const makeFsError = (code: string): Error & { code: string } => {
  const err = new Error(code) as Error & { code: string };
  err.code = code;
  return err;
};

describe("applyRenames", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-apply-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty outcome for an empty plan", async () => {
    const result = await applyRenames(emptyPlan(), tmpDir);

    expect(result.renamed).toEqual([]);
    expect(result.errored).toEqual([]);
    expect(result.skippedAlreadyPrefixed).toEqual([]);
    expect(result.skippedCollision).toEqual([]);
    expect(result.interrupted).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("propagates skipped buckets from the input plan", async () => {
    const result = await applyRenames(
      emptyPlan({
        skippedAlreadyPrefixed: ["already.wav"],
        skippedCollision: ["collide.wav"],
      }),
      tmpDir,
    );

    expect(result.skippedAlreadyPrefixed).toEqual(["already.wav"]);
    expect(result.skippedCollision).toEqual(["collide.wav"]);
  });

  it("renames three files sequentially and updates the disk", async () => {
    await writeFile(path.join(tmpDir, "a.wav"), "a");
    await writeFile(path.join(tmpDir, "b.wav"), "b");
    await writeFile(path.join(tmpDir, "c.wav"), "c");

    const plan = emptyPlan({
      operations: [
        { from: "a.wav", to: "P-a.wav" },
        { from: "b.wav", to: "P-b.wav" },
        { from: "c.wav", to: "P-c.wav" },
      ],
    });

    const result = await applyRenames(plan, tmpDir);

    expect(result.renamed).toEqual(["a.wav", "b.wav", "c.wav"]);
    expect(result.errored).toEqual([]);
    expect(result.interrupted).toBe(false);

    const entries = (await readdir(tmpDir)).sort();
    expect(entries).toEqual(["P-a.wav", "P-b.wav", "P-c.wav"]);
  });

  it("reports EEXIST when the target already exists on disk (APFS post-rename guard)", async () => {
    await writeFile(path.join(tmpDir, "src.wav"), "src");
    await writeFile(path.join(tmpDir, "target.wav"), "target");

    const plan = emptyPlan({
      operations: [{ from: "src.wav", to: "target.wav" }],
    });

    const result = await applyRenames(plan, tmpDir);

    expect(result.renamed).toEqual([]);
    expect(result.errored).toEqual([{ file: "src.wav", reason: "EEXIST" }]);

    const entries = (await readdir(tmpDir)).sort();
    expect(entries).toEqual(["src.wav", "target.wav"]);
  });

  it("continues the loop after a partial failure", async () => {
    await writeFile(path.join(tmpDir, "a.wav"), "a");
    await writeFile(path.join(tmpDir, "b.wav"), "b");
    await writeFile(path.join(tmpDir, "c.wav"), "c");
    await writeFile(path.join(tmpDir, "P-b.wav"), "pre-existing");

    const plan = emptyPlan({
      operations: [
        { from: "a.wav", to: "P-a.wav" },
        { from: "b.wav", to: "P-b.wav" },
        { from: "c.wav", to: "P-c.wav" },
      ],
    });

    const result = await applyRenames(plan, tmpDir);

    expect(result.renamed).toEqual(["a.wav", "c.wav"]);
    expect(result.errored).toEqual([{ file: "b.wav", reason: "EEXIST" }]);
  });

  it("captures non-EXDEV rename errors with their code", async () => {
    await writeFile(path.join(tmpDir, "src.wav"), "src");

    const fsMock: FsLike = {
      rename: vi.fn(() => Promise.reject(makeFsError("EACCES"))),
      copyFile: vi.fn(),
      unlink: vi.fn(),
    };

    const plan = emptyPlan({
      operations: [{ from: "src.wav", to: "P-src.wav" }],
    });

    const result = await applyRenames(plan, tmpDir, { fs: fsMock });

    expect(result.renamed).toEqual([]);
    expect(result.errored).toEqual([{ file: "src.wav", reason: "EACCES" }]);
    expect(fsMock.copyFile).not.toHaveBeenCalled();
    expect(fsMock.unlink).not.toHaveBeenCalled();
  });

  it("falls back to copyFile + unlink on EXDEV", async () => {
    await writeFile(path.join(tmpDir, "src.wav"), "content");

    const fsMock: FsLike = {
      rename: vi.fn(() => Promise.reject(makeFsError("EXDEV"))),
      copyFile: vi.fn(realCopyFile),
      unlink: vi.fn(realUnlink),
    };

    const plan = emptyPlan({
      operations: [{ from: "src.wav", to: "P-src.wav" }],
    });

    const result = await applyRenames(plan, tmpDir, { fs: fsMock });

    expect(result.renamed).toEqual(["src.wav"]);
    expect(result.errored).toEqual([]);
    expect(fsMock.rename).toHaveBeenCalledOnce();
    expect(fsMock.copyFile).toHaveBeenCalledOnce();
    expect(fsMock.unlink).toHaveBeenCalledOnce();

    const entries = (await readdir(tmpDir)).sort();
    expect(entries).toEqual(["P-src.wav"]);
  });

  it("reports the copyFile error if the EXDEV fallback copy fails", async () => {
    await writeFile(path.join(tmpDir, "src.wav"), "content");

    const fsMock: FsLike = {
      rename: vi.fn(() => Promise.reject(makeFsError("EXDEV"))),
      copyFile: vi.fn(() => Promise.reject(makeFsError("ENOSPC"))),
      unlink: vi.fn(),
    };

    const plan = emptyPlan({
      operations: [{ from: "src.wav", to: "P-src.wav" }],
    });

    const result = await applyRenames(plan, tmpDir, { fs: fsMock });

    expect(result.renamed).toEqual([]);
    expect(result.errored).toEqual([{ file: "src.wav", reason: "ENOSPC" }]);
    expect(fsMock.unlink).not.toHaveBeenCalled();
  });

  it("marks the file as DUPLICATED if unlink fails after a successful copyFile", async () => {
    await writeFile(path.join(tmpDir, "src.wav"), "content");

    const fsMock: FsLike = {
      rename: vi.fn(() => Promise.reject(makeFsError("EXDEV"))),
      copyFile: vi.fn(realCopyFile),
      unlink: vi.fn(() => Promise.reject(makeFsError("EACCES"))),
    };

    const plan = emptyPlan({
      operations: [{ from: "src.wav", to: "P-src.wav" }],
    });

    const result = await applyRenames(plan, tmpDir, { fs: fsMock });

    expect(result.renamed).toEqual([]);
    expect(result.errored).toEqual([
      { file: "src.wav", reason: "DUPLICATED (EACCES)" },
    ]);

    const entries = (await readdir(tmpDir)).sort();
    expect(entries).toEqual(["P-src.wav", "src.wav"]);
  });

  it("returns UNKNOWN when the thrown value lacks a code", async () => {
    await writeFile(path.join(tmpDir, "src.wav"), "content");

    const fsMock: FsLike = {
      rename: vi.fn(() => Promise.reject(new Error("oops"))),
      copyFile: vi.fn(),
      unlink: vi.fn(),
    };

    const plan = emptyPlan({
      operations: [{ from: "src.wav", to: "P-src.wav" }],
    });

    const result = await applyRenames(plan, tmpDir, { fs: fsMock });

    expect(result.errored).toEqual([{ file: "src.wav", reason: "UNKNOWN" }]);
  });

  it("stops the loop and reports interrupted when aborted mid-batch", async () => {
    await writeFile(path.join(tmpDir, "a.wav"), "a");
    await writeFile(path.join(tmpDir, "b.wav"), "b");
    await writeFile(path.join(tmpDir, "c.wav"), "c");

    const controller = new AbortController();
    const fsMock: FsLike = {
      rename: vi.fn(async (from: string, to: string) => {
        await realRename(from, to);
        controller.abort();
      }),
      copyFile: vi.fn(),
      unlink: vi.fn(),
    };

    const plan = emptyPlan({
      operations: [
        { from: "a.wav", to: "P-a.wav" },
        { from: "b.wav", to: "P-b.wav" },
        { from: "c.wav", to: "P-c.wav" },
      ],
    });

    const result = await applyRenames(plan, tmpDir, {
      signal: controller.signal,
      fs: fsMock,
    });

    expect(result.renamed).toEqual(["a.wav"]);
    expect(result.interrupted).toBe(true);
    expect(fsMock.rename).toHaveBeenCalledOnce();

    const entries = (await readdir(tmpDir)).sort();
    expect(entries).toContain("P-a.wav");
    expect(entries).toContain("b.wav");
    expect(entries).toContain("c.wav");
    expect(entries).not.toContain("P-b.wav");
  });

  it("does not run any rename when the signal is already aborted", async () => {
    await writeFile(path.join(tmpDir, "a.wav"), "a");

    const controller = new AbortController();
    controller.abort();

    const fsMock: FsLike = {
      rename: vi.fn(),
      copyFile: vi.fn(),
      unlink: vi.fn(),
    };

    const plan = emptyPlan({
      operations: [{ from: "a.wav", to: "P-a.wav" }],
    });

    const result = await applyRenames(plan, tmpDir, {
      signal: controller.signal,
      fs: fsMock,
    });

    expect(result.renamed).toEqual([]);
    expect(result.interrupted).toBe(true);
    expect(fsMock.rename).not.toHaveBeenCalled();
  });

  it("measures a non-negative durationMs", async () => {
    await writeFile(path.join(tmpDir, "a.wav"), "a");

    const plan = emptyPlan({
      operations: [{ from: "a.wav", to: "P-a.wav" }],
    });

    const result = await applyRenames(plan, tmpDir);

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
