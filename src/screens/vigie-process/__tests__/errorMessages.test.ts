import { describe, expect, it } from "vitest";
import {
  mapKnownProcessErrorCode,
  mapProcessErrorCodeToMessage,
} from "../errorMessages.js";

const UNEXPECTED_MESSAGE_PREFIX = "erreur inattendue";

/**
 * Every *identifiable* code family actually emitted by the producers,
 * grepped from `splitWavFile.ts` (SplitErrorCode literals), `splitWorker.ts`
 * / `splitWorkerPool.ts` (raw fs errno strings, `mkdir:<code>`, and the
 * dead-worker codes `worker-died` / `worker-spawn-failed` /
 * `no-workers-available`) and `soxFastPath.ts` (`sox-exit:<code>`,
 * `sox-no-output`, `non-aligned-data-size:<dataSize>/<bytesPerSample>`,
 * `mkdir:<code>`, raw fs errno strings). One representative instance per
 * dynamic-suffix family.
 *
 * `UNKNOWN` (the `extractErrorCode` fallback when a thrown error has no
 * `.code`) and the `splitWorker.ts` catch-all that forwards `err.message`
 * verbatim are intentionally excluded: both are genuinely unidentifiable
 * error shapes, so falling through to the generic "erreur inattendue"
 * message is the correct behaviour, not a completeness gap.
 */
const EMITTED_CODES = [
  "invalid-header",
  "unsupported-format",
  "unsupported-bit-depth",
  "no-samples",
  "ENOENT",
  "EACCES",
  "EPERM",
  "ENOSPC",
  "EROFS",
  "EXDEV",
  "mkdir:ENOSPC",
  "sox-exit:1",
  "sox-no-output",
  "non-aligned-data-size:100/2",
  "worker-died",
  "worker-spawn-failed",
  "no-workers-available",
] as const;

describe("mapProcessErrorCodeToMessage — producer/consumer completeness", () => {
  it.each(EMITTED_CODES)(
    "maps %s to a specific message, not the generic fallback",
    (code) => {
      expect(mapProcessErrorCodeToMessage(code)).not.toMatch(
        UNEXPECTED_MESSAGE_PREFIX,
      );
    },
  );

  it("still falls back to the generic message for a truly unknown code", () => {
    expect(mapProcessErrorCodeToMessage("some-unmapped-code")).toBe(
      "erreur inattendue (code: some-unmapped-code)",
    );
  });

  it("falls back to the generic message for UNKNOWN (unidentifiable error shape)", () => {
    expect(mapProcessErrorCodeToMessage("UNKNOWN")).toBe(
      "erreur inattendue (code: UNKNOWN)",
    );
  });

  it("no longer special-cases the dead write: prefix", () => {
    expect(mapProcessErrorCodeToMessage("write:ENOSPC")).toBe(
      "erreur inattendue (code: write:ENOSPC)",
    );
  });
});

describe("mapKnownProcessErrorCode", () => {
  it.each(EMITTED_CODES)("returns a non-null message for %s", (code) => {
    expect(mapKnownProcessErrorCode(code)).not.toBeNull();
  });

  it("returns null for an unrecognized code (used by the run-error screen to skip the message line)", () => {
    expect(mapKnownProcessErrorCode("some-unmapped-code")).toBeNull();
  });

  it.each([
    ["EROFS", "ce disque est protégé en écriture"],
    ["EXDEV", "impossible de déplacer le fichier d'un disque à un autre"],
    ["sox-exit:1", "chiro n'a pas réussi à traiter cet enregistrement"],
    ["worker-died", "le découpage s'est interrompu de façon inattendue"],
    [
      "worker-spawn-failed",
      "le découpage s'est interrompu de façon inattendue",
    ],
    [
      "no-workers-available",
      "le découpage s'est interrompu de façon inattendue",
    ],
  ] as const)(
    "wording for %s starts with the expected action",
    (code, expectedPrefix) => {
      expect(mapKnownProcessErrorCode(code)).toContain(expectedPrefix);
    },
  );
});
