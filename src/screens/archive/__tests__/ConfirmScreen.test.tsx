import { render } from "ink-testing-library";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CreateZipArchiveOptions,
  CreateZipArchiveResult,
} from "../../../lib/archive/createZipArchive.js";
import type { ArchiveEntryStat } from "../../../lib/archive/planArchive.js";
import { ConfirmScreen, type CreateZipArchiveFn } from "../ConfirmScreen.js";
import type { ArchiveRunOutcome } from "../useArchiveRun.js";

/**
 * Polls until `predicate` is true, or throws after `timeoutMs`. Needed
 * because the loading → preview transition depends on real `fs` I/O
 * (`resolveArchiveFileName`, `hasExistingArchiveZip`).
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

/** Wait for Ink's key-flush (≥ 80ms). */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 80));

const sampleEntries: ArchiveEntryStat[] = [
  { name: "a_001.wav", size: 4, mtime: new Date("2026-01-01T00:00:00Z") },
  { name: "a_002.wav", size: 8, mtime: new Date("2026-01-01T00:00:00Z") },
];
const sampleTotalBytes = 12;

const neverCalled: CreateZipArchiveFn = () => {
  throw new Error("createZipArchive must not be called before Entrée");
};

/**
 * A stub whose call is captured for later assertions and that resolves
 * immediately with `result`.
 */
const makeRecordingZipStub = (
  result: CreateZipArchiveResult,
): {
  fn: CreateZipArchiveFn;
  getCapturedOptions: () => CreateZipArchiveOptions | undefined;
} => {
  const capturedBox: { current: CreateZipArchiveOptions | undefined } = {
    current: undefined,
  };
  const fn: CreateZipArchiveFn = (opts) => {
    capturedBox.current = opts;
    return Promise.resolve(result);
  };
  return { fn, getCapturedOptions: () => capturedBox.current };
};

/**
 * A manual controller: the returned promise never resolves on its own, only
 * when the test calls `resolve(...)`. Lets a test observe the AbortSignal
 * passed in (e.g. on Ctrl+C) before deciding how the run ends. Mirrors
 * vigie-process's `makeAbortAwareStub`.
 */
const makeManualZipStub = (): {
  fn: CreateZipArchiveFn;
  getSignal: () => AbortSignal | undefined;
  resolve: (result: CreateZipArchiveResult) => void;
} => {
  const signalBox: { current: AbortSignal | undefined } = {
    current: undefined,
  };
  const resolveBox: {
    current: ((result: CreateZipArchiveResult) => void) | undefined;
  } = { current: undefined };
  const fn: CreateZipArchiveFn = (opts) => {
    signalBox.current = opts.signal;
    return new Promise((resolve) => {
      resolveBox.current = resolve;
    });
  };
  return {
    fn,
    getSignal: () => signalBox.current,
    resolve: (result) => resolveBox.current?.(result),
  };
};

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(tmpdir(), "chiro-test-archive-confirm-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

const renderConfirmScreen = (
  createZipArchive: CreateZipArchiveFn,
  options?: {
    runningRef?: { current: boolean };
    onComplete?: (outcome: ArchiveRunOutcome) => void;
    onBack?: () => void;
  },
) =>
  render(
    <ConfirmScreen
      cwd={tmpDir}
      entries={sampleEntries}
      totalBytes={sampleTotalBytes}
      runningRef={options?.runningRef ?? { current: false }}
      createZipArchive={createZipArchive}
      onComplete={options?.onComplete ?? (() => undefined)}
      onBack={options?.onBack ?? (() => undefined)}
    />,
  );

const waitForPreview = (lastFrame: () => string | undefined): Promise<void> =>
  waitUntil(() => !(lastFrame() ?? "").includes("Préparation…"));

describe("ArchiveConfirmScreen — preview", () => {
  it("shows the resolved file name, location, size cap, and reassurance lines", async () => {
    const { lastFrame } = renderConfirmScreen(neverCalled);
    await waitForPreview(lastFrame);

    const frame = lastFrame() ?? "";
    expect(frame).toMatch(/processed_\d{12}\.zip/);
    expect(frame).toContain("./archived/");
    expect(frame).toContain("au plus ");
    expect(frame).toContain("Vos enregistrements restent dans ./processed/.");
    expect(frame).toContain("Entrée créer le zip   Échap revenir au début");
  });

  it("calls onBack on Échap without calling createZipArchive", async () => {
    const onBack = vi.fn();
    const { stdin, lastFrame } = renderConfirmScreen(neverCalled, {
      onBack,
    });
    await waitForPreview(lastFrame);

    stdin.write("\x1b");
    await settle();

    expect(onBack).toHaveBeenCalledOnce();
  });

  it("does not mention an existing zip when 'archived/' has none yet", async () => {
    const { lastFrame } = renderConfirmScreen(neverCalled);
    await waitForPreview(lastFrame);

    expect(lastFrame() ?? "").not.toContain("Un zip existe déjà");
  });

  it("mentions an existing zip when 'archived/' already holds a processed_*.zip", async () => {
    const archivedDir = path.join(tmpDir, "archived");
    await mkdir(archivedDir);
    await writeFile(
      path.join(archivedDir, "processed_202601010000.zip"),
      "fake zip content",
    );

    const { lastFrame } = renderConfirmScreen(neverCalled);
    await waitForPreview(lastFrame);

    expect(lastFrame() ?? "").toContain("Un zip existe déjà dans ./archived/");
  });
});

describe("ArchiveConfirmScreen — Entrée triggers the run", () => {
  it("calls createZipArchive with a consistent sourceDir/entries/zipPath, then onComplete with the ok outcome", async () => {
    const okResult: CreateZipArchiveResult = {
      kind: "ok",
      zipPath: "placeholder-overwritten-by-real-path",
      zipBytes: 999,
      entryCount: sampleEntries.length,
      durationMs: 42,
    };
    const { fn, getCapturedOptions } = makeRecordingZipStub(okResult);
    const onComplete = vi.fn();

    const { stdin, lastFrame } = renderConfirmScreen(fn, { onComplete });
    await waitForPreview(lastFrame);

    stdin.write("\r");
    await waitUntil(() => onComplete.mock.calls.length > 0);

    const captured = getCapturedOptions();
    expect(captured?.sourceDir).toBe(path.join(tmpDir, "processed"));
    expect(captured?.entries).toEqual(sampleEntries);
    expect(captured?.zipPath.startsWith(path.join(tmpDir, "archived"))).toBe(
      true,
    );
    expect(path.basename(captured?.zipPath ?? "")).toMatch(
      /^processed_\d{12}(-\d+)?\.zip$/,
    );

    expect(onComplete).toHaveBeenCalledWith(okResult);
  });

  it("calls onComplete with the aborted outcome when createZipArchive resolves aborted", async () => {
    const { fn } = makeRecordingZipStub({ kind: "aborted" });
    const onComplete = vi.fn();

    const { stdin, lastFrame } = renderConfirmScreen(fn, { onComplete });
    await waitForPreview(lastFrame);

    stdin.write("\r");
    await waitUntil(() => onComplete.mock.calls.length > 0);

    expect(onComplete).toHaveBeenCalledWith({ kind: "aborted" });
  });
});

describe("ArchiveConfirmScreen — run-error", () => {
  it("shows the generic warning, the safety reassurance, the mapped French label, and the full untruncated raw code", async () => {
    const { fn } = makeRecordingZipStub({ kind: "error", code: "ENOSPC" });

    const { stdin, lastFrame } = renderConfirmScreen(fn);
    await waitForPreview(lastFrame);

    stdin.write("\r");
    await waitUntil(() =>
      (lastFrame() ?? "").includes(
        "Une erreur est survenue pendant la création du zip.",
      ),
    );
    await settle();

    const frame = lastFrame() ?? "";
    expect(frame).toContain(
      "Une erreur est survenue pendant la création du zip.",
    );
    expect(frame).toContain(
      "Aucun fichier zip n'a été créé — vos enregistrements sont intacts.",
    );
    expect(frame).toContain(
      "Plus de place sur le disque — libérez de l'espace puis relancez.",
    );
    expect(frame).toContain("Détail technique : ENOSPC");
    // Regression guard: the raw code must never be wrapped/truncated
    // mid-word by Ink's line wrapping (bug once seen on the vigie-process
    // equivalent screen).
    expect(frame).not.toContain("ENOSP\n");
    expect(frame).not.toContain("ENOS\n");
  });
});

describe("ArchiveConfirmScreen — Ctrl+C during running", () => {
  it("aborts the signal passed to createZipArchive", async () => {
    const { fn, getSignal, resolve } = makeManualZipStub();

    const { stdin, lastFrame } = renderConfirmScreen(fn);
    await waitForPreview(lastFrame);

    stdin.write("\r");
    await waitUntil(() =>
      (lastFrame() ?? "").includes("Création du zip en cours…"),
    );

    expect(getSignal()?.aborted).toBe(false);

    stdin.write("\x03");
    await waitUntil(() => getSignal()?.aborted === true);

    expect(getSignal()?.aborted).toBe(true);

    // Let the in-flight run settle so nothing dangles past the test.
    resolve({ kind: "aborted" });
  });
});
