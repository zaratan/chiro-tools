import {
  copyFile as defaultCopyFile,
  rename as defaultRename,
  unlink as defaultUnlink,
  writeFile as defaultWriteFile,
} from "node:fs/promises";

export type RenameFsLike = {
  rename: (from: string, to: string) => Promise<void>;
  copyFile: (from: string, to: string) => Promise<void>;
  unlink: (file: string) => Promise<void>;
};

export type WriteFsLike = RenameFsLike & {
  writeFile: (file: string, data: Uint8Array) => Promise<void>;
};

export type SafeFsResult = { kind: "ok" } | { kind: "error"; code: string };

const defaultRenameFs: RenameFsLike = {
  rename: defaultRename,
  copyFile: defaultCopyFile,
  unlink: defaultUnlink,
};

const defaultWriteFs: WriteFsLike = {
  ...defaultRenameFs,
  writeFile: (file, data) => defaultWriteFile(file, data),
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
 * Writes a buffer to `targetPath` atomically: writes to `targetPath + ".tmp"`,
 * then renames. On EXDEV (cross-device, typical with SD-card → home dir),
 * falls back to copyFile + unlink of the tmp.
 *
 * Never throws. Returns a tagged Result.
 *
 * On failure mid-flow (tmp written but rename failed), the tmp is unlinked
 * best-effort (errors ignored — orphan tmp pre-clean is the caller's job).
 */
export const writeFileAtomic = async (
  targetPath: string,
  data: Uint8Array,
  options?: { signal?: AbortSignal; fs?: WriteFsLike },
): Promise<SafeFsResult> => {
  if (options?.signal?.aborted === true) {
    return { kind: "error", code: "ABORT_ERR" };
  }

  const fs = options?.fs ?? defaultWriteFs;
  const tmpPath = `${targetPath}.tmp`;

  try {
    await fs.writeFile(tmpPath, data);
  } catch (writeErr) {
    return { kind: "error", code: extractErrorCode(writeErr) };
  }

  const renameResult = await renameWithFallback(tmpPath, targetPath, options);
  if (renameResult.kind === "error") {
    // best-effort cleanup of orphan tmp — errors ignored
    fs.unlink(tmpPath).catch(() => undefined);
    return renameResult;
  }

  return { kind: "ok" };
};
