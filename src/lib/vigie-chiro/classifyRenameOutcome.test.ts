import { describe, expect, it } from "vitest";
import type { RenameOutcome } from "../../types.js";
import { classifyRenameOutcome } from "./classifyRenameOutcome.js";

const outcome = (overrides: Partial<RenameOutcome>): RenameOutcome => ({
  renamed: [],
  skippedAlreadyPrefixed: [],
  skippedCollision: [],
  errored: [],
  interrupted: false,
  durationMs: 1,
  ...overrides,
});

describe("classifyRenameOutcome", () => {
  it("reports a plain success when every planned file was renamed", () => {
    expect(
      classifyRenameOutcome(
        outcome({
          renamed: ["a.wav", "b.wav"],
          skippedAlreadyPrefixed: ["Car1-x.wav"],
        }),
      ),
    ).toEqual({
      kind: "success",
      renamedCount: 2,
      alreadyCount: 1,
      collisions: [],
    });
  });

  it("reports nothing to do only when every file was already prefixed", () => {
    expect(
      classifyRenameOutcome(
        outcome({ skippedAlreadyPrefixed: ["Car1-a.wav", "Car1-b.wav"] }),
      ),
    ).toEqual({ kind: "nothing-to-do", alreadyCount: 2 });
  });

  it("does not claim everything is already in format when raw copies collide with prefixed files", () => {
    expect(
      classifyRenameOutcome(
        outcome({
          skippedAlreadyPrefixed: ["Car1-a.wav", "Car1-b.wav", "Car1-c.wav"],
          skippedCollision: ["a.wav", "b.wav", "c.wav"],
        }),
      ),
    ).toEqual({
      kind: "nothing-renamed",
      alreadyCount: 3,
      collisions: ["a.wav", "b.wav", "c.wav"],
    });
  });

  it("does not report success with zero renamed when every file collides", () => {
    expect(
      classifyRenameOutcome(outcome({ skippedCollision: ["a.wav"] })),
    ).toEqual({
      kind: "nothing-renamed",
      alreadyCount: 0,
      collisions: ["a.wav"],
    });
  });

  it("keeps the collisions alongside a success so the screen can list them", () => {
    expect(
      classifyRenameOutcome(
        outcome({ renamed: ["a.wav"], skippedCollision: ["b.wav"] }),
      ),
    ).toEqual({
      kind: "success",
      renamedCount: 1,
      alreadyCount: 0,
      collisions: ["b.wav"],
    });
  });

  it("carries the errors met before an interruption so they are not hidden", () => {
    expect(
      classifyRenameOutcome(
        outcome({
          renamed: ["a.wav"],
          errored: [{ file: "b.wav", reason: "EACCES" }],
          skippedCollision: ["c.wav"],
          interrupted: true,
        }),
      ),
    ).toEqual({
      kind: "interrupted",
      renamedCount: 1,
      errored: [{ file: "b.wav", reason: "EACCES" }],
      collisions: ["c.wav"],
    });
  });

  it("reports partial errors with the plan-time collisions kept apart from the rename-time errors", () => {
    expect(
      classifyRenameOutcome(
        outcome({
          renamed: ["a.wav"],
          errored: [{ file: "b.wav", reason: "EEXIST" }],
          skippedCollision: ["c.wav"],
        }),
      ),
    ).toEqual({
      kind: "partial-errors",
      renamedCount: 1,
      errored: [{ file: "b.wav", reason: "EEXIST" }],
      collisions: ["c.wav"],
    });
  });

  it("keeps the errors visible when nothing was renamed and some files also collided", () => {
    expect(
      classifyRenameOutcome(
        outcome({
          errored: [{ file: "a.wav", reason: "EACCES" }],
          skippedCollision: ["b.wav"],
        }),
      ).kind,
    ).toBe("partial-errors");
  });

  it("reports the interruption rather than a collision summary when nothing was renamed before the stop", () => {
    expect(
      classifyRenameOutcome(
        outcome({
          errored: [{ file: "a.wav", reason: "EACCES" }],
          skippedCollision: ["b.wav"],
          interrupted: true,
        }),
      ).kind,
    ).toBe("interrupted");
  });
});
