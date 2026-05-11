import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionEvent } from "../../types.js";
import { logSession } from "./log.js";

const makeEvent = (overrides: Partial<SessionEvent> = {}): SessionEvent => ({
  schema_version: 1,
  ts: "2026-05-11T21:30:45.123Z",
  version: "0.1.0",
  cwd: "/Users/test/Vigie-2026-A1",
  action: "vigie-prefix",
  input: { squareCode: "040962", year: 2026, passNumber: 3, pointCode: "A1" },
  result: {
    renamed: 7,
    skipped_already_prefixed: 1,
    skipped_collision: 0,
    errored: [],
    interrupted: false,
    duration_ms: 42,
  },
  ...overrides,
});

let tmpDir: string;

beforeEach(async () => {
  const unique = `chiro-log-test-${Date.now().toString()}-${Math.random().toString(36).slice(2)}`;
  tmpDir = path.join(os.tmpdir(), unique);
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const readLines = async (filePath: string): Promise<string[]> => {
  const content = await readFile(filePath, "utf-8");
  return content.split("\n").filter((l) => l.length > 0);
};

describe("logSession", () => {
  it("creates the log file if absent", async () => {
    const logFile = path.join(tmpDir, "sessions.jsonl");

    await logSession(makeEvent(), logFile);

    const content = await readFile(logFile, "utf-8");
    expect(content.length).toBeGreaterThan(0);
  });

  it("creates the parent directory if absent", async () => {
    const logFile = path.join(tmpDir, "nested", "deep", "sessions.jsonl");

    await logSession(makeEvent(), logFile);

    const content = await readFile(logFile, "utf-8");
    expect(content.length).toBeGreaterThan(0);
  });

  it("appends a single JSONL line terminated by newline", async () => {
    const logFile = path.join(tmpDir, "sessions.jsonl");
    const event = makeEvent();

    await logSession(event, logFile);

    const content = await readFile(logFile, "utf-8");
    const lines = await readLines(logFile);
    expect(lines).toHaveLength(1);
    expect(content.endsWith("\n")).toBe(true);

    const [firstLine] = lines;
    expect(JSON.parse(firstLine ?? "")).toEqual(event);
  });

  it("produces three lines after three appends", async () => {
    const logFile = path.join(tmpDir, "sessions.jsonl");
    const event1 = makeEvent({ ts: "2026-05-11T21:30:45.001Z" });
    const event2 = makeEvent({ ts: "2026-05-11T21:30:45.002Z" });
    const event3 = makeEvent({ ts: "2026-05-11T21:30:45.003Z" });

    await logSession(event1, logFile);
    await logSession(event2, logFile);
    await logSession(event3, logFile);

    const lines = await readLines(logFile);
    expect(lines).toHaveLength(3);

    const [line1, line2, line3] = lines;
    expect(JSON.parse(line1 ?? "")).toEqual(event1);
    expect(JSON.parse(line2 ?? "")).toEqual(event2);
    expect(JSON.parse(line3 ?? "")).toEqual(event3);
  });

  it("preserves schema_version === 1 in the serialized line", async () => {
    const logFile = path.join(tmpDir, "sessions.jsonl");

    await logSession(makeEvent(), logFile);

    const [firstLine] = await readLines(logFile);
    const parsed = JSON.parse(firstLine ?? "") as { schema_version: unknown };
    expect(parsed.schema_version).toBe(1);
  });

  it("does not corrupt pre-existing content", async () => {
    const logFile = path.join(tmpDir, "sessions.jsonl");
    await writeFile(logFile, "existing\n", "utf-8");

    const event = makeEvent();
    await logSession(event, logFile);

    const lines = await readLines(logFile);
    expect(lines).toHaveLength(2);

    const [existingLine, newLine] = lines;
    expect(existingLine).toBe("existing");
    expect(JSON.parse(newLine ?? "")).toEqual(event);
  });
});
