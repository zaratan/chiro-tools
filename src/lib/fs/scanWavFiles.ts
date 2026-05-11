import { readdir } from "node:fs/promises";

/**
 * Extension filter: accepts `.wav` and `.WAV` (case-insensitive on extension only).
 */
const WAV_EXTENSION_REGEX = /\.wav$/i;

/**
 * Scans a directory non-recursively and returns the names of WAV files,
 * sorted alphabetically.
 *
 * Filtering rules:
 * - Extension `.wav` or `.WAV` (case-insensitive on extension only)
 * - Hidden files (dotfiles) are ignored
 * - Subdirectories are ignored
 * - Symlinks are ignored (Dirent.isFile() returns false for them)
 *
 * @param dir Absolute path of the directory to scan.
 * @returns The list of filenames (not absolute paths), sorted alphabetically (locale-independent).
 */
export const scanWavFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });

  const wavFiles = entries
    .filter((dirent) => dirent.isFile())
    .filter((dirent) => !dirent.name.startsWith("."))
    .filter((dirent) => WAV_EXTENSION_REGEX.test(dirent.name))
    .map((dirent) => dirent.name);

  return wavFiles.sort();
};
