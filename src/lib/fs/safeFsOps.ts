import {
  copyFile as defaultCopyFile,
  open,
  rename as defaultRename,
  unlink as defaultUnlink,
} from "node:fs/promises";

export type RenameFsLike = {
  rename: (from: string, to: string) => Promise<void>;
  copyFile: (from: string, to: string) => Promise<void>;
  unlink: (file: string) => Promise<void>;
};

export type SafeFsResult = { kind: "ok" } | { kind: "error"; code: string };

const defaultRenameFs: RenameFsLike = {
  rename: defaultRename,
  copyFile: defaultCopyFile,
  unlink: defaultUnlink,
};

export const extractErrorCode = (err: unknown): string => {
  if (
    err instanceof Error &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string"
  ) {
    return (err as { code: string }).code;
  }
  return "UNKNOWN";
};

/**
 * Renames `from` to `to`. On EXDEV (cross-device, typical with SD-card → home
 * dir), falls back to copyFile + unlink. If unlink fails after a successful
 * copy, the source is left in place and the error is reported.
 *
 * Never throws. Returns a tagged Result.
 */
export const renameWithFallback = async (
  from: string,
  to: string,
  options?: { signal?: AbortSignal; fs?: RenameFsLike },
): Promise<SafeFsResult> => {
  if (options?.signal?.aborted === true) {
    return { kind: "error", code: "ABORT_ERR" };
  }

  const fs = options?.fs ?? defaultRenameFs;

  try {
    await fs.rename(from, to);
    return { kind: "ok" };
  } catch (err) {
    const code = extractErrorCode(err);
    if (code !== "EXDEV") {
      return { kind: "error", code };
    }
  }

  // EXDEV fallback: cross-device move via copy + unlink
  try {
    await fs.copyFile(from, to);
  } catch (copyErr) {
    return { kind: "error", code: extractErrorCode(copyErr) };
  }

  try {
    await fs.unlink(from);
    return { kind: "ok" };
  } catch (unlinkErr) {
    return {
      kind: "error",
      code: `DUPLICATED (${extractErrorCode(unlinkErr)})`,
    };
  }
};

/**
 * Whether a PID currently belongs to a running process. Used to tell a
 * leftover temp file/directory from one a live chiro instance is still
 * writing to.
 *
 * `EPERM` counts as alive: the process exists but belongs to another user.
 */
export const isAliveProcess = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return extractErrorCode(err) === "EPERM";
  }
};

/**
 * Best-effort `fsync` of a directory — never throws; `false` just means the
 * durability guarantee was not obtained. A file `fsync` makes its *contents*
 * durable, but a rename changes the *directory*, whose entry can stay in
 * cache: after a power cut the bytes can be on disk without the folder
 * knowing their name.
 */
export const fsyncDirBestEffort = async (dir: string): Promise<boolean> => {
  try {
    const dirFh = await open(dir, "r");
    try {
      await dirFh.sync();
    } finally {
      await dirFh.close();
    }
    return true;
  } catch {
    return false;
  }
};
