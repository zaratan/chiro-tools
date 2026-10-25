import { describe, expect, it } from "vitest";
import type { RenameOutcome } from "../../types.js";
import { classifyRenameOutcome } from "./classifyRenameOutcome.js";

const outcome = (overrides: Partial<RenameOutcome>): RenameOutcome => ({
  renamed: [],
  whitespaceFixed: [],
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
      whitespaceFixedCount: 0,
      alreadyCount: 1,
      collisions: [],
      collisionsHaveWhitespace: false,
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
      collisionsHaveWhitespace: false,
    });
  });

  it("does not report success with zero renamed when every file collides", () => {
    expect(
      classifyRenameOutcome(outcome({ skippedCollision: ["a.wav"] })),
    ).toEqual({
      kind: "nothing-renamed",
      alreadyCount: 0,
      collisions: ["a.wav"],
      collisionsHaveWhitespace: false,
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
      whitespaceFixedCount: 0,
      alreadyCount: 0,
      collisions: ["b.wav"],
      collisionsHaveWhitespace: false,
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
      whitespaceFixedCount: 0,
      errored: [{ file: "b.wav", reason: "EACCES" }],
      collisions: ["c.wav"],
      collisionsHaveWhitespace: false,
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
      whitespaceFixedCount: 0,
      errored: [{ file: "b.wav", reason: "EEXIST" }],
      collisions: ["c.wav"],
      collisionsHaveWhitespace: false,
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

  it("reports a success, not nothing to do, when only spaces were fixed", () => {
    expect(
      classifyRenameOutcome(
        outcome({
          whitespaceFixed: ["Car1-a b.wav"],
          skippedAlreadyPrefixed: ["Car1-c.wav"],
        }),
      ),
    ).toEqual({
      kind: "success",
      renamedCount: 0,
      whitespaceFixedCount: 1,
      alreadyCount: 1,
      collisions: [],
      collisionsHaveWhitespace: false,
    });
  });

  it("reports a success, not nothing renamed, when spaces were fixed and other files collided", () => {
    expect(
      classifyRenameOutcome(
        outcome({
          whitespaceFixed: ["Car1-a b.wav"],
          skippedCollision: ["a b.wav"],
        }),
      ).kind,
    ).toBe("success");
  });

  it("flags a collision whose name holds a space, since the split would refuse it", () => {
    const variant = classifyRenameOutcome(
      outcome({
        whitespaceFixed: ["Car1-a b.wav"],
        skippedCollision: ["clean.wav", "a b.wav"],
      }),
    );

    expect(variant.kind === "success" && variant.collisionsHaveWhitespace).toBe(
      true,
    );
  });

  it("counts the spaces fixed before an interruption", () => {
    const variant = classifyRenameOutcome(
      outcome({
        renamed: ["a.wav"],
        whitespaceFixed: ["Car1-b c.wav"],
        interrupted: true,
      }),
    );

    expect(variant).toMatchObject({
      kind: "interrupted",
      renamedCount: 1,
      whitespaceFixedCount: 1,
    });
  });
});
