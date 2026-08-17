import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPowerState } from "../powerState.js";

const setPlatform = (platform: NodeJS.Platform): void => {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
};

const makeFakePmset = async (dir: string, output: string): Promise<void> => {
  const p = path.join(dir, "pmset");
  await writeFile(p, `#!/bin/sh\nprintf '%s\\n' "${output}"\nexit 0\n`);
  await chmod(p, 0o755);
};

describe("readPowerState", () => {
  let tmpDir: string;
  const originalPlatform = process.platform;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-powerstate-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    delete process.env.PATH;
    setPlatform(originalPlatform);
  });

  it("returns unknown on non-darwin platforms, without spawning anything", () => {
    setPlatform("linux");
    expect(readPowerState()).toBe("unknown");
  });

  it("returns ac when pmset reports AC Power", async () => {
    setPlatform("darwin");
    await makeFakePmset(
      tmpDir,
      " Now drawing from 'AC Power' -InternalBattery-0 (id=1)\t100%; charged",
    );
    process.env.PATH = tmpDir;
    expect(readPowerState()).toBe("ac");
  });

  it("returns battery when pmset reports Battery Power", async () => {
    setPlatform("darwin");
    await makeFakePmset(
      tmpDir,
      " Now drawing from 'Battery Power' -InternalBattery-0 (id=1)\t62%; discharging",
    );
    process.env.PATH = tmpDir;
    expect(readPowerState()).toBe("battery");
  });

  it("returns unknown when pmset exits non-zero", async () => {
    setPlatform("darwin");
    const p = path.join(tmpDir, "pmset");
    await writeFile(p, "#!/bin/sh\nexit 1\n");
    await chmod(p, 0o755);
    process.env.PATH = tmpDir;
    expect(readPowerState()).toBe("unknown");
  });

  it("returns unknown when pmset is not on PATH", () => {
    setPlatform("darwin");
    process.env.PATH = tmpDir;
    expect(readPowerState()).toBe("unknown");
  });

  it("returns unknown on output matching neither marker", async () => {
    setPlatform("darwin");
    await makeFakePmset(tmpDir, "something unexpected");
    process.env.PATH = tmpDir;
    expect(readPowerState()).toBe("unknown");
  });
});
