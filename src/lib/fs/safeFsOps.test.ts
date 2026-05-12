import {
  copyFile as realCopyFile,
  mkdtemp,
  readFile,
  readdir,
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
  writeFileAtomic,
  type RenameFsLike,
  type WriteFsLike,
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

describe("writeFileAtomic", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-safefs-atomic-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes a file via tmp + rename", async () => {
    const target = path.join(tmpDir, "out.bin");
    const data = new Uint8Array([1, 2, 3, 4]);

    const result = await writeFileAtomic(target, data);

    expect(result).toEqual({ kind: "ok" });
    const written = await readFile(target);
    expect(Array.from(written)).toEqual([1, 2, 3, 4]);

    const entries = await readdir(tmpDir);
    expect(entries).toEqual(["out.bin"]); // tmp removed
  });

  it("returns the writeFile error code without leaving a tmp", async () => {
    const fsMock: WriteFsLike = {
      writeFile: vi.fn(() => Promise.reject(makeFsError("ENOSPC"))),
      rename: vi.fn(),
      copyFile: vi.fn(),
      unlink: vi.fn(),
    };

    const result = await writeFileAtomic("/some/where.bin", new Uint8Array(1), {
      fs: fsMock,
    });

    expect(result).toEqual({ kind: "error", code: "ENOSPC" });
    expect(fsMock.rename).not.toHaveBeenCalled();
  });

  it("cleans up tmp on rename failure (best effort)", async () => {
    const target = path.join(tmpDir, "out.bin");
    const tmpPath = `${target}.tmp`;
    const renameErr = makeFsError("EACCES");

    let tmpExisted = false;
    const fsMock: WriteFsLike = {
      writeFile: vi.fn(async (file, data) => {
        await realWriteFile(file as string, data as Uint8Array);
      }),
      rename: vi.fn(async () => {
        // Verify the tmp was written before we fail.
        await readFile(tmpPath);
        tmpExisted = true;
        throw renameErr;
      }),
      copyFile: vi.fn(),
      unlink: vi.fn(realUnlink),
    };

    const result = await writeFileAtomic(target, new Uint8Array([9]), {
      fs: fsMock,
    });

    expect(result).toEqual({ kind: "error", code: "EACCES" });
    expect(tmpExisted).toBe(true);

    // Give the best-effort unlink a microtask to run.
    await new Promise((r) => setImmediate(r));
    const entries = await readdir(tmpDir);
    expect(entries).toEqual([]); // tmp removed by best-effort cleanup
  });

  it("returns ABORT_ERR if signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fsMock: WriteFsLike = {
      writeFile: vi.fn(),
      rename: vi.fn(),
      copyFile: vi.fn(),
      unlink: vi.fn(),
    };

    const result = await writeFileAtomic("/x", new Uint8Array(0), {
      signal: controller.signal,
      fs: fsMock,
    });

    expect(result).toEqual({ kind: "error", code: "ABORT_ERR" });
    expect(fsMock.writeFile).not.toHaveBeenCalled();
  });
});
