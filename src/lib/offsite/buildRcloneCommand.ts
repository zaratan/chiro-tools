export type RcloneCommand = {
  command: string;
  args: string[];
};

/**
 * Builds the command to spawn for an rclone invocation. On darwin, the
 * caffeinate binary *prefixes* the command instead of being spawned as a
 * second, separate process. A separate `spawn("caffeinate", [...])` would
 * survive a `kill -9` of chiro, a crash, or the terminal closing — leaving
 * the Mac unable to sleep, invisibly, until the next reboot, with nothing in
 * chiro able to detect or explain it. Prefixed, caffeinate is rclone's own
 * parent process: it dies with its child by construction, so there is no
 * lifecycle to manage and no orphan to leak. Elsewhere, nothing is
 * prefixed — Linux has no caffeinate equivalent chiro reaches for here.
 */
export const buildRcloneCommand = (
  platform: NodeJS.Platform,
  rcloneBinPath: string,
  rcloneArgs: readonly string[],
): RcloneCommand => {
  if (platform === "darwin") {
    return {
      command: "caffeinate",
      args: ["-i", "-s", rcloneBinPath, ...rcloneArgs],
    };
  }
  return { command: rcloneBinPath, args: [...rcloneArgs] };
};
