import { realpathSync } from "node:fs";

// Edge case: if bun itself is brew-installed (`brew install oven-sh/bun/bun`),
// `pnpm dev` will see process.execPath in /Cellar/ and treat dev as a brew
// install — disabling auto-update in dev. Accepted: only affects the project
// maintainer, and the kill-switch is desirable in that environment anyway.
export const isHomebrewInstall = (
  execPath: string = process.execPath,
): boolean => {
  let resolved: string;
  try {
    resolved = realpathSync(execPath);
  } catch {
    resolved = execPath;
  }
  return resolved.includes("/Cellar/");
};
