import { describe, expect, it } from "vitest";
import { buildRcloneCommand } from "../buildRcloneCommand.js";

describe("buildRcloneCommand", () => {
  it("prefixes caffeinate -i -s on darwin", () => {
    const result = buildRcloneCommand("darwin", "/usr/local/bin/rclone", [
      "copyto",
      "src",
      "dst",
    ]);
    expect(result).toEqual({
      command: "caffeinate",
      args: ["-i", "-s", "/usr/local/bin/rclone", "copyto", "src", "dst"],
    });
  });

  it("spawns rclone directly on linux, with no caffeinate prefix", () => {
    const result = buildRcloneCommand("linux", "/usr/bin/rclone", [
      "copyto",
      "src",
      "dst",
    ]);
    expect(result).toEqual({
      command: "/usr/bin/rclone",
      args: ["copyto", "src", "dst"],
    });
  });

  it("does not prefix on any other platform", () => {
    const result = buildRcloneCommand("win32", "rclone", ["version"]);
    expect(result).toEqual({ command: "rclone", args: ["version"] });
  });

  it("returns a fresh args array, not the caller's own reference", () => {
    const rcloneArgs = ["copyto", "src", "dst"];
    const result = buildRcloneCommand("linux", "rclone", rcloneArgs);
    expect(result.args).not.toBe(rcloneArgs);
    expect(result.args).toEqual(rcloneArgs);
  });

  it("handles an empty rcloneArgs list", () => {
    expect(buildRcloneCommand("linux", "rclone", [])).toEqual({
      command: "rclone",
      args: [],
    });
    expect(buildRcloneCommand("darwin", "rclone", [])).toEqual({
      command: "caffeinate",
      args: ["-i", "-s", "rclone"],
    });
  });
});
