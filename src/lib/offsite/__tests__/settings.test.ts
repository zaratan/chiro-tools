import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadOffsiteSettings } from "../settings.js";

describe("loadOffsiteSettings", () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "chiro-settings-"));
    filePath = path.join(dir, "settings.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns absent when the file does not exist", async () => {
    const result = await loadOffsiteSettings(filePath);
    expect(result).toEqual({ kind: "absent" });
  });

  it("returns absent when a parent directory does not exist either", async () => {
    const result = await loadOffsiteSettings(
      path.join(dir, "nested", "settings.json"),
    );
    expect(result).toEqual({ kind: "absent" });
  });

  it("parses a well-formed settings file", async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        coffre: {
          remote: "chiro-coffre",
          bucket: "chiro-manon",
          prefix: "vigie-chiro",
        },
      }),
      "utf8",
    );

    const result = await loadOffsiteSettings(filePath);
    expect(result).toEqual({
      kind: "ok",
      settings: {
        remote: "chiro-coffre",
        bucket: "chiro-manon",
        prefix: "vigie-chiro",
      },
    });
  });

  it("trims whitespace around string fields", async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        coffre: {
          remote: "  chiro-coffre  ",
          bucket: " chiro-manon ",
          prefix: " vigie-chiro ",
        },
      }),
      "utf8",
    );

    const result = await loadOffsiteSettings(filePath);
    expect(result).toEqual({
      kind: "ok",
      settings: {
        remote: "chiro-coffre",
        bucket: "chiro-manon",
        prefix: "vigie-chiro",
      },
    });
  });

  it("strips leading and trailing slashes from prefix", async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        coffre: {
          remote: "chiro-coffre",
          bucket: "chiro-manon",
          prefix: "/vigie-chiro/",
        },
      }),
      "utf8",
    );

    const result = await loadOffsiteSettings(filePath);
    expect(result).toEqual({
      kind: "ok",
      settings: {
        remote: "chiro-coffre",
        bucket: "chiro-manon",
        prefix: "vigie-chiro",
      },
    });
  });

  it("is invalid when the file is not valid JSON", async () => {
    await writeFile(filePath, "{not json", "utf8");
    const result = await loadOffsiteSettings(filePath);
    expect(result.kind).toBe("invalid");
  });

  it("is invalid when the JSON is not an object (e.g. a bare number)", async () => {
    await writeFile(filePath, "42", "utf8");
    const result = await loadOffsiteSettings(filePath);
    expect(result.kind).toBe("invalid");
  });

  it("is invalid when the JSON is an array", async () => {
    await writeFile(filePath, "[]", "utf8");
    const result = await loadOffsiteSettings(filePath);
    expect(result.kind).toBe("invalid");
  });

  it('is invalid when "coffre" is missing', async () => {
    await writeFile(filePath, JSON.stringify({}), "utf8");
    const result = await loadOffsiteSettings(filePath);
    expect(result.kind).toBe("invalid");
  });

  it('is invalid when "coffre" is not an object', async () => {
    await writeFile(filePath, JSON.stringify({ coffre: "nope" }), "utf8");
    const result = await loadOffsiteSettings(filePath);
    expect(result.kind).toBe("invalid");
  });

  it("is invalid when remote is missing", async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        coffre: { bucket: "chiro-manon", prefix: "vigie-chiro" },
      }),
      "utf8",
    );
    const result = await loadOffsiteSettings(filePath);
    expect(result.kind).toBe("invalid");
  });

  it("is invalid when remote is an empty string", async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        coffre: { remote: "  ", bucket: "chiro-manon", prefix: "vigie-chiro" },
      }),
      "utf8",
    );
    const result = await loadOffsiteSettings(filePath);
    expect(result.kind).toBe("invalid");
  });

  it("is invalid when remote is not a string", async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        coffre: { remote: 123, bucket: "chiro-manon", prefix: "vigie-chiro" },
      }),
      "utf8",
    );
    const result = await loadOffsiteSettings(filePath);
    expect(result.kind).toBe("invalid");
  });

  it('is invalid when remote contains ":" (looks like "remote:bucket")', async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        coffre: {
          remote: "chiro-coffre:chiro-manon",
          bucket: "chiro-manon",
          prefix: "vigie-chiro",
        },
      }),
      "utf8",
    );
    const result = await loadOffsiteSettings(filePath);
    expect(result.kind).toBe("invalid");
  });

  it("is invalid when bucket is missing", async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        coffre: { remote: "chiro-coffre", prefix: "vigie-chiro" },
      }),
      "utf8",
    );
    const result = await loadOffsiteSettings(filePath);
    expect(result.kind).toBe("invalid");
  });

  it("is invalid when prefix is missing", async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        coffre: { remote: "chiro-coffre", bucket: "chiro-manon" },
      }),
      "utf8",
    );
    const result = await loadOffsiteSettings(filePath);
    expect(result.kind).toBe("invalid");
  });

  it("is invalid when prefix is only slashes (empty once normalized)", async () => {
    await writeFile(
      filePath,
      JSON.stringify({
        coffre: {
          remote: "chiro-coffre",
          bucket: "chiro-manon",
          prefix: "///",
        },
      }),
      "utf8",
    );
    const result = await loadOffsiteSettings(filePath);
    expect(result.kind).toBe("invalid");
  });

  it("uses the default ~/.chiro/settings.json path when no filePath is given", async () => {
    // Just verifies the call does not throw and resolves to a tagged
    // result — the real ~/.chiro/settings.json is not expected to exist
    // (or be valid) on a CI/dev machine, either is an acceptable outcome.
    const result = await loadOffsiteSettings();
    expect(["ok", "absent", "invalid"]).toContain(result.kind);
  });

  it("is invalid rather than throwing when the path points at a directory", async () => {
    const dirAsFile = path.join(dir, "a-directory");
    await mkdir(dirAsFile);
    const result = await loadOffsiteSettings(dirAsFile);
    expect(result.kind).toBe("invalid");
  });
});
