import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import type { ProcessInput } from "../../../types.js";
import { ConfirmScreen, type ProcessWavFilesFn } from "../ConfirmScreen.js";

/**
 * Polls until `predicate` is true, or throws after `timeoutMs`. Needed
 * because the loading → preview transition depends on real `fs` I/O
 * (`estimateChunkCount`), whose latency on the first test in a file can
 * exceed a couple of `setImmediate` ticks.
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

const renderConfirmScreen = (
  processWavFiles: ProcessWavFilesFn,
  runningRef: { current: boolean },
) => {
  const input: ProcessInput = { mode: "preserve" };
  return render(
    <ConfirmScreen
      cwd="/tmp/chiro-test-does-not-exist"
      input={input}
      wavFiles={["a.wav"]}
      runningRef={runningRef}
      processWavFiles={processWavFiles}
      onComplete={() => undefined}
      onBack={() => undefined}
    />,
  );
};

/** Renders, waits for the loading→preview transition, submits, and waits for run-error. */
const triggerRunError = async (
  processWavFiles: ProcessWavFilesFn,
  runningRef: { current: boolean },
): Promise<() => string> => {
  const { stdin, lastFrame } = renderConfirmScreen(processWavFiles, runningRef);
  await waitUntil(() => !(lastFrame() ?? "").includes("Estimation…"));
  stdin.write("\r");
  await waitUntil(() =>
    (lastFrame() ?? "").includes(
      "⚠ Une erreur est survenue pendant le découpage.",
    ),
  );
  await settle();
  return () => lastFrame() ?? "";
};

describe("ProcessConfirmScreen — run-error (degraded)", () => {
  it("shows the cwd, the full raw code, and the French label, and clears runningRef, when processWavFiles rejects", async () => {
    const runningRef = { current: false };
    const failingProcess: ProcessWavFilesFn = () =>
      Promise.reject(Object.assign(new Error("boom"), { code: "ENOSPC" }));

    const getFrame = await triggerRunError(failingProcess, runningRef);

    const frame = getFrame();
    expect(frame).toContain("📁 /tmp/chiro-test-does-not-exist");
    expect(frame).toContain("⚠ Une erreur est survenue pendant le découpage.");
    expect(frame).toContain(
      "Plus de place sur le disque — libérez de l'espace puis relancez.",
    );
    expect(frame).toContain("Détail technique : ENOSPC");
    expect(frame).toContain("(à transmettre si vous demandez de l'aide)");
    expect(frame).not.toContain("ENOSP\n");
    expect(runningRef.current).toBe(false);
  });

  it("shows only the raw code, without a message line, for an unrecognized code", async () => {
    const runningRef = { current: false };
    const failingProcess: ProcessWavFilesFn = () =>
      Promise.reject(Object.assign(new Error("boom"), { code: "EWEIRD" }));

    const getFrame = await triggerRunError(failingProcess, runningRef);

    const frame = getFrame();
    expect(frame).toContain("Détail technique : EWEIRD");
    expect(frame).not.toContain("erreur inattendue");
  });

  it("shows the 'revenir au début' footer hint", async () => {
    const runningRef = { current: false };
    const failingProcess: ProcessWavFilesFn = () =>
      Promise.reject(Object.assign(new Error("boom"), { code: "ENOSPC" }));

    const getFrame = await triggerRunError(failingProcess, runningRef);

    expect(getFrame()).toContain("Échap revenir au début");
  });

  it("keeps 'chiro' lowercase even sentence-initial (brand name convention)", async () => {
    const runningRef = { current: false };
    const failingProcess: ProcessWavFilesFn = () =>
      Promise.reject(Object.assign(new Error("boom"), { code: "sox-exit:1" }));

    const getFrame = await triggerRunError(failingProcess, runningRef);

    const frame = getFrame();
    expect(frame).toContain(
      "chiro n'a pas réussi à traiter cet enregistrement",
    );
    expect(frame).not.toContain("Chiro n'a pas réussi");
  });
});
