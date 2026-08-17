import { describe, expect, it } from "vitest";
import { CHIRO_VERSION } from "../../version.js";
import {
  buildOffsiteSessionEvent,
  type OffsiteSessionOutcome,
} from "./buildOffsiteSessionEvent.js";

describe("buildOffsiteSessionEvent", () => {
  it("builds a schema_version 6 vigie-upload event with the current CHIRO_VERSION", () => {
    const outcome: OffsiteSessionOutcome = {
      kind: "ok",
      zipName: "processed_20260817.zip",
      zipBytes: 1_000_000,
      remote: "chiro-coffre",
      bucket: "chiro-manon",
      remoteKey: "vigie-chiro/processed_20260817.zip",
      verified: "size-match",
      attempts: 1,
    };

    const event = buildOffsiteSessionEvent(outcome, 42, "/tmp/x");

    expect(event.schema_version).toBe(6);
    expect(event.action).toBe("vigie-upload");
    expect(event.version).toBe(CHIRO_VERSION);
    expect(event.cwd).toBe("/tmp/x");
  });

  it("maps an 'ok' outcome to status ok with every remote-identifying field", () => {
    const outcome: OffsiteSessionOutcome = {
      kind: "ok",
      zipName: "processed_20260817.zip",
      zipBytes: 1_000_000,
      remote: "chiro-coffre",
      bucket: "chiro-manon",
      remoteKey: "vigie-chiro/processed_20260817.zip",
      verified: "size-match",
      attempts: 2,
    };

    const event = buildOffsiteSessionEvent(outcome, 42, "/tmp/x");
    if (event.schema_version !== 6) throw new Error("type narrowing");

    expect(event.result).toEqual({
      status: "ok",
      zip_name: "processed_20260817.zip",
      zip_bytes: 1_000_000,
      remote: "chiro-coffre",
      bucket: "chiro-manon",
      remote_key: "vigie-chiro/processed_20260817.zip",
      verified: "size-match",
      attempts: 2,
      duration_ms: 42,
    });
  });

  it("maps an 'ok' outcome with verified: unavailable through unchanged", () => {
    const outcome: OffsiteSessionOutcome = {
      kind: "ok",
      zipName: "processed_20260817.zip",
      zipBytes: 1_000_000,
      remote: "chiro-coffre",
      bucket: "chiro-manon",
      remoteKey: "vigie-chiro/processed_20260817.zip",
      verified: "unavailable",
      attempts: 1,
    };

    const event = buildOffsiteSessionEvent(outcome, 42, "/tmp/x");
    if (event.schema_version !== 6) throw new Error("type narrowing");
    if (event.result.status !== "ok") throw new Error("type narrowing");

    expect(event.result.verified).toBe("unavailable");
  });

  it("maps an 'aborted' outcome to status aborted with bytes_sent, no remote fields", () => {
    const outcome: OffsiteSessionOutcome = {
      kind: "aborted",
      zipName: "processed_20260817.zip",
      zipBytes: 1_000_000,
      bytesSent: 400_000,
    };

    const event = buildOffsiteSessionEvent(outcome, 42, "/tmp/x");
    if (event.schema_version !== 6) throw new Error("type narrowing");

    expect(event.result).toEqual({
      status: "aborted",
      zip_name: "processed_20260817.zip",
      zip_bytes: 1_000_000,
      bytes_sent: 400_000,
      duration_ms: 42,
    });
  });

  it("maps an 'error' outcome to status error with error_code and bytes_sent", () => {
    const outcome: OffsiteSessionOutcome = {
      kind: "error",
      code: "network",
      zipName: "processed_20260817.zip",
      zipBytes: 1_000_000,
      bytesSent: 100_000,
    };

    const event = buildOffsiteSessionEvent(outcome, 42, "/tmp/x");
    if (event.schema_version !== 6) throw new Error("type narrowing");

    expect(event.result).toEqual({
      status: "error",
      error_code: "network",
      zip_name: "processed_20260817.zip",
      zip_bytes: 1_000_000,
      bytes_sent: 100_000,
      duration_ms: 42,
    });
  });
});
