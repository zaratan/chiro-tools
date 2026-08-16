import {
  copyFile as realCopyFile,
  mkdtemp,
  readFile,
  rm,
  unlink as realUnlink,
  writeFile as realWriteFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractErrorCode,
  renameWithFallback,
  type RenameFsLike,
} from "./safeFsOps.js";

const makeFsError = (code: string): Error & { code: string } => {
  const err = new Error(code) as Error & { code: string };
  err.code = code;
  return err;
};

describe("extractErrorCode", () => {
  it("returns the code from an Error with a code property", () => {
    expect(extractErrorCode(makeFsError("ENOENT"))).toBe("ENOENT");
  });

  it("returns UNKNOWN for plain Error", () => {
    expect(extractErrorCode(new Error("boom"))).toBe("UNKNOWN");
  });

  it("returns UNKNOWN for non-Error values", () => {
    expect(extractErrorCode("string")).toBe("UNKNOWN");
    expect(extractErrorCode(null)).toBe("UNKNOWN");
    expect(extractErrorCode(undefined)).toBe("UNKNOWN");
  });
});

describe("renameWithFallback", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-safefs-rename-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("renames a file in place", async () => {
    const from = path.join(tmpDir, "a.txt");
    const to = path.join(tmpDir, "b.txt");
    await realWriteFile(from, "content");

    const result = await renameWithFallback(from, to);

    expect(result).toEqual({ kind: "ok" });
    expect(await readFile(to, "utf-8")).toBe("content");
  });

  it("returns an error code on non-EXDEV failure", async () => {
    const fsMock: RenameFsLike = {
      rename: vi.fn(() => Promise.reject(makeFsError("EACCES"))),
      copyFile: vi.fn(),
      unlink: vi.fn(),
    };

    const result = await renameWithFallback("/a", "/b", { fs: fsMock });

    expect(result).toEqual({ kind: "error", code: "EACCES" });
    expect(fsMock.copyFile).not.toHaveBeenCalled();
    expect(fsMock.unlink).not.toHaveBeenCalled();
  });

  it("falls back to copyFile + unlink on EXDEV", async () => {
    const from = path.join(tmpDir, "a.txt");
    const to = path.join(tmpDir, "b.txt");
    await realWriteFile(from, "x");

    const fsMock: RenameFsLike = {
      rename: vi.fn(() => Promise.reject(makeFsError("EXDEV"))),
      copyFile: vi.fn(realCopyFile),
      unlink: vi.fn(realUnlink),
    };

    const result = await renameWithFallback(from, to, { fs: fsMock });

    expect(result).toEqual({ kind: "ok" });
    expect(fsMock.copyFile).toHaveBeenCalledWith(from, to);
    expect(fsMock.unlink).toHaveBeenCalledWith(from);
  });

  it("reports DUPLICATED if unlink fails after EXDEV copy succeeds", async () => {
    const fsMock: RenameFsLike = {
      rename: vi.fn(() => Promise.reject(makeFsError("EXDEV"))),
      copyFile: vi.fn(() => Promise.resolve()),
      unlink: vi.fn(() => Promise.reject(makeFsError("EBUSY"))),
    };

    const result = await renameWithFallback("/a", "/b", { fs: fsMock });

    expect(result).toEqual({ kind: "error", code: "DUPLICATED (EBUSY)" });
  });

  it("returns ABORT_ERR if signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await renameWithFallback("/a", "/b", {
      signal: controller.signal,
    });

    expect(result).toEqual({ kind: "error", code: "ABORT_ERR" });
  });
});
