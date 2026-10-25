import { describe, expect, it } from "vitest";
import type { FormInput, RenameOutcome, RenamePlan } from "../../types.js";
import { CHIRO_VERSION } from "../../version.js";
import { buildVigiePrefixSessionEvent } from "./buildVigiePrefixSessionEvent.js";

const input: FormInput = {
  squareCode: "123456",
  year: 2026,
  passNumber: 2,
  pointCode: "A1",
};
const pass1 = "Car123456-2026-Pass1-A1-";
const pass2 = "Car123456-2026-Pass2-A1-";

const emptyPlan: RenamePlan = {
  operations: [],
  skippedAlreadyPrefixed: [],
  skippedCollision: [],
};

const outcome = (overrides: Partial<RenameOutcome>): RenameOutcome => ({
  renamed: [],
  whitespaceFixed: [],
  reprefixed: [],
  skippedAlreadyPrefixed: [],
  skippedCollision: [],
  errored: [],
  interrupted: false,
  durationMs: 12,
  ...overrides,
});

const resultOf = (
  plan: RenamePlan,
  done: RenameOutcome,
): Record<string, unknown> => {
  const event = buildVigiePrefixSessionEvent(input, plan, done, "/tmp/x");
  return event.action === "vigie-prefix" ? event.result : {};
};

describe("buildVigiePrefixSessionEvent", () => {
  it("builds a schema_version 7 vigie-prefix event with the current CHIRO_VERSION", () => {
    const event = buildVigiePrefixSessionEvent(
      input,
      emptyPlan,
      outcome({}),
      "/tmp/x",
    );

    expect(event).toMatchObject({
      schema_version: 7,
      action: "vigie-prefix",
      version: CHIRO_VERSION,
      cwd: "/tmp/x",
      input,
    });
  });

  it("records the prefix found on files run again with another pass, so the session is no longer undecidable", () => {
    const files = [`${pass1}a.wav`, `${pass1}b.wav`];
    const plan: RenamePlan = {
      ...emptyPlan,
      operations: files.map((from) => ({
        from,
        to: from.replace(pass1, pass2),
        kind: "reprefix" as const,
      })),
    };

    expect(resultOf(plan, outcome({ reprefixed: files }))).toEqual({
      renamed: 2,
      whitespace_fixed: 0,
      reprefixed: 2,
      skipped_already_prefixed: 0,
      skipped_collision: 0,
      other_prefix: 2,
      prefixes_found: [pass1],
      prefixes_found_count: 1,
      errored: [],
      interrupted: false,
      duration_ms: 12,
    });
  });

  it("counts every kind of rename in renamed, and each kind on its own", () => {
    const done = outcome({
      renamed: ["raw.wav"],
      whitespaceFixed: [`${pass2}a b.wav`],
      reprefixed: [`${pass1}c.wav`],
    });

    expect(resultOf(emptyPlan, done)).toMatchObject({
      renamed: 3,
      whitespace_fixed: 1,
      reprefixed: 1,
    });
  });

  it("keeps the files planned with another prefix when the run was interrupted before them", () => {
    const plan: RenamePlan = {
      ...emptyPlan,
      operations: [
        { from: `${pass1}a.wav`, to: `${pass2}a.wav`, kind: "reprefix" },
        { from: `${pass1}b.wav`, to: `${pass2}b.wav`, kind: "reprefix" },
      ],
    };

    expect(
      resultOf(
        plan,
        outcome({ reprefixed: [`${pass1}a.wav`], interrupted: true }),
      ),
    ).toMatchObject({ reprefixed: 1, other_prefix: 2, interrupted: true });
  });

  it("counts a file with another prefix that ended in collision", () => {
    const plan: RenamePlan = {
      ...emptyPlan,
      skippedCollision: [`${pass1}a.wav`],
    };

    expect(
      resultOf(plan, outcome({ skippedCollision: [`${pass1}a.wav`] })),
    ).toMatchObject({ other_prefix: 1, prefixes_found: [pass1] });
  });

  it("lists the typed prefix too when files already carried it", () => {
    const plan: RenamePlan = {
      ...emptyPlan,
      operations: [
        { from: `${pass1}a.wav`, to: `${pass2}a.wav`, kind: "reprefix" },
      ],
      skippedAlreadyPrefixed: [`${pass2}b.wav`],
    };

    expect(resultOf(plan, outcome({}))).toMatchObject({
      prefixes_found: [pass1, pass2],
      prefixes_found_count: 2,
    });
  });

  it("bounds the list of prefixes found at 20 but keeps the true count", () => {
    const files = Array.from(
      { length: 25 },
      (_, i) => `Car123456-2026-Pass${(i + 1).toString()}-A1-x.wav`,
    );
    const plan: RenamePlan = { ...emptyPlan, skippedCollision: files };

    const result = resultOf(plan, outcome({}));

    expect(result.prefixes_found).toHaveLength(20);
    expect(result.prefixes_found_count).toBe(25);
  });
});
