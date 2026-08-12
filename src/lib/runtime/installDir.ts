import { realpathSync } from "node:fs";
import { basename, dirname } from "node:path";

/**
 * Environment override pointing install.sh at the directory of the currently
 * running binary, so a self-update replaces it in place. Without it, a binary
 * living outside ~/.local/bin (e.g. manually copied to /usr/local/bin) would
 * be "updated" into ~/.local/bin and PATH order would decide which one runs.
 *
 * Returns an empty object (no override) when:
 * - the user already set CHIRO_INSTALL_DIR themselves;
 * - the executable is not a compiled chiro binary (in dev, process.execPath
 *   is the bun executable — installing into bun's directory would be wrong).
 */
export const resolveInstallDirEnv = (
  execPath: string = process.execPath,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> => {
  if (env.CHIRO_INSTALL_DIR !== undefined && env.CHIRO_INSTALL_DIR !== "") {
    return {};
  }
  let realPath: string;
  try {
    realPath = realpathSync(execPath);
  } catch {
    return {};
  }
  // Strict equality: `chiro` is exactly (and only) the name install.sh
  // writes. Release artifacts (`chiro-darwin-arm64`) extracted by hand and
  // dev runs (`bun`) must NOT redirect the install into their own directory
  // — falling back to install.sh's default (~/.local/bin) is correct there.
  if (basename(realPath) !== "chiro") return {};
  return { CHIRO_INSTALL_DIR: dirname(realPath) };
};
