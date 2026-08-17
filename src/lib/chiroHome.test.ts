import { homedir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chiroHomeDir } from "./chiroHome.js";

describe("chiroHomeDir", () => {
  it("joins .chiro onto the user's home directory", () => {
    expect(chiroHomeDir()).toBe(path.join(homedir(), ".chiro"));
  });
});
