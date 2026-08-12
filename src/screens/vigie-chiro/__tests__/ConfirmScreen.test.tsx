import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import type { FormInput } from "../../../types.js";
import { ConfirmScreen, type ApplyRenamesFn } from "../ConfirmScreen.js";

/**
 * Polls until `predicate` is true, or throws after `timeoutMs`. Needed
 * because the loading → plan-ready transition depends on real `fs` I/O
 * (`planRenames`), whose latency on the first test in a file can exceed a
 * couple of `setImmediate` ticks.
 */
const waitUntil = async (
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitUntil: timed out");
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
};

/** Wait for Ink's escape-key flush (≥ 80ms). */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 80));

const input: FormInput = {
  squareCode: "040962",
  year: 2026,
  passNumber: 3,
  pointCode: "A1",
};

const renderConfirmScreen = (
  applyRenames: ApplyRenamesFn,
  runningRef: { current: boolean },
) =>
  render(
    <ConfirmScreen
      cwd="/tmp/chiro-test-does-not-exist"
      input={input}
      wavFiles={["a.wav"]}
      runningRef={runningRef}
      applyRenames={applyRenames}
      onComplete={() => undefined}
      onBack={() => undefined}
    />,
  );

/** Renders, waits for the loading→plan-ready transition, submits, and waits for run-error. */
const triggerRunError = async (
  applyRenames: ApplyRenamesFn,
  runningRef: { current: boolean },
): Promise<() => string> => {
  const { stdin, lastFrame } = renderConfirmScreen(applyRenames, runningRef);
  await waitUntil(() => !(lastFrame() ?? "").includes("Préparation du plan…"));
  stdin.write("\r");
  await waitUntil(() =>
    (lastFrame() ?? "").includes(
      "⚠ Une erreur est survenue pendant le renommage.",
    ),
  );
  await settle();
  return () => lastFrame() ?? "";
};

describe("ConfirmScreen (vigie-chiro) — run-error (degraded)", () => {
  it("shows the cwd, the full raw code (non-regression on the truncation bug), and clears runningRef, when applyRenames rejects", async () => {
    const runningRef = { current: false };
    const failingApply: ApplyRenamesFn = () =>
      Promise.reject(Object.assign(new Error("boom"), { code: "ENOSPC" }));

    const getFrame = await triggerRunError(failingApply, runningRef);

    const frame = getFrame();
    expect(frame).toContain("📁 /tmp/chiro-test-does-not-exist");
    expect(frame).toContain("⚠ Une erreur est survenue pendant le renommage.");
    expect(frame).toContain("Détail technique : ENOSPC");
    expect(frame).toContain("(à transmettre si vous demandez de l'aide)");
    expect(frame).not.toContain("ENOSP\n");
    expect(runningRef.current).toBe(false);
  });

  it("shows the capitalized French label as a sentence for a known code", async () => {
    const runningRef = { current: false };
    const failingApply: ApplyRenamesFn = () =>
      Promise.reject(Object.assign(new Error("boom"), { code: "ENOENT" }));

    const getFrame = await triggerRunError(failingApply, runningRef);

    const frame = getFrame();
    expect(frame).toContain("Le fichier a disparu pendant l'opération.");
    expect(frame).toContain("Détail technique : ENOENT");
  });

  it("shows only the raw code, without a message line, for an unrecognized code", async () => {
    const runningRef = { current: false };
    const failingApply: ApplyRenamesFn = () =>
      Promise.reject(Object.assign(new Error("boom"), { code: "EWEIRD" }));

    const getFrame = await triggerRunError(failingApply, runningRef);

    const frame = getFrame();
    expect(frame).toContain("Détail technique : EWEIRD");
    expect(frame).not.toContain("erreur inattendue");
  });

  it("shows the 'revenir au début' footer hint", async () => {
    const runningRef = { current: false };
    const failingApply: ApplyRenamesFn = () =>
      Promise.reject(Object.assign(new Error("boom"), { code: "ENOSPC" }));

    const getFrame = await triggerRunError(failingApply, runningRef);

    expect(getFrame()).toContain("Échap revenir au début");
  });
});
