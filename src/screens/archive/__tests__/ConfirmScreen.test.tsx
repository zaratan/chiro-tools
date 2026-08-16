import { render } from "ink-testing-library";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEvent } from "../../../types.js";
import { ConfirmScreen } from "../ConfirmScreen.js";
import type {
  ArchiveRunner,
  ArchiveRunnerResult,
  ArchiveRunOutcome,
  BuildRunSessionEvent,
  ResolveTargetName,
} from "../useArchiveRun.js";

/**
 * Polls until `predicate` is true, or throws after `timeoutMs`.
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

const sampleEntries = [
  { name: "a_001.wav", size: 4, mtime: new Date("2026-01-01T00:00:00Z") },
  { name: "a_002.wav", size: 8, mtime: new Date("2026-01-01T00:00:00Z") },
];
const sampleTotalBytes = 12;

const stubSessionEvent: SessionEvent = {
  schema_version: 3,
  ts: "2026-01-01T00:00:00.000Z",
  version: "test",
  cwd: "/tmp",
  action: "vigie-archive",
  result: {
    status: "ok",
    zip_name: "stub.zip",
    entry_count: 0,
    total_bytes: 0,
    zip_bytes: 0,
    duration_ms: 0,
  },
};
const buildSessionEvent: BuildRunSessionEvent = () => stubSessionEvent;

const okResolveTargetName: ResolveTargetName = () =>
  Promise.resolve({ name: "processed_20260101.zip", alreadyExists: false });

const neverCalled: ArchiveRunner = () => {
  throw new Error("runner must not be called before Entrée");
};

/**
 * A stub whose call is captured for later assertions and that resolves
 * immediately with `result`.
 */
const makeRecordingRunner = (
  result: ArchiveRunnerResult,
): {
  runner: ArchiveRunner;
  getCapturedSignal: () => AbortSignal | undefined;
} => {
  const signalBox: { current: AbortSignal | undefined } = {
    current: undefined,
  };
  const runner: ArchiveRunner = (opts) => {
    signalBox.current = opts.signal;
    return Promise.resolve(result);
  };
  return { runner, getCapturedSignal: () => signalBox.current };
};

/**
 * A manual controller: the returned promise never resolves on its own, only
 * when the test calls `resolve(...)`. Lets a test observe the AbortSignal
 * passed in (e.g. on Ctrl+C) before deciding how the run ends.
 */
const makeManualRunner = (): {
  runner: ArchiveRunner;
  getSignal: () => AbortSignal | undefined;
  resolve: (result: ArchiveRunnerResult) => void;
} => {
  const signalBox: { current: AbortSignal | undefined } = {
    current: undefined,
  };
  const resolveBox: {
    current: ((result: ArchiveRunnerResult) => void) | undefined;
  } = { current: undefined };
  const runner: ArchiveRunner = (opts) => {
    signalBox.current = opts.signal;
    return new Promise<ArchiveRunnerResult>((resolve) => {
      resolveBox.current = resolve;
    });
  };
  return {
    runner,
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
  runner: ArchiveRunner,
  options?: {
    mode?: "backup" | "package";
    totalBytes?: number;
    resolveTargetName?: ResolveTargetName;
    runningRef?: { current: boolean };
    onComplete?: (outcome: ArchiveRunOutcome) => void;
    onBack?: () => void;
  },
) =>
  render(
    <ConfirmScreen
      mode={options?.mode ?? "backup"}
      cwd={tmpDir}
      entries={sampleEntries}
      totalBytes={options?.totalBytes ?? sampleTotalBytes}
      runningRef={options?.runningRef ?? { current: false }}
      runner={runner}
      resolveTargetName={options?.resolveTargetName ?? okResolveTargetName}
      buildSessionEvent={buildSessionEvent}
      onComplete={options?.onComplete ?? (() => undefined)}
      onBack={options?.onBack ?? (() => undefined)}
    />,
  );

const waitForPreview = (lastFrame: () => string | undefined): Promise<void> =>
  waitUntil(() => !(lastFrame() ?? "").includes("Préparation…"));

describe("ArchiveConfirmScreen — preview, backup mode", () => {
  it("shows the resolved file name, location, size cap, and reassurance lines", async () => {
    const { lastFrame } = renderConfirmScreen(neverCalled);
    await waitForPreview(lastFrame);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("processed_20260101.zip");
    expect(frame).toContain("./archived/");
    expect(frame).toContain("au plus ");
    expect(frame).toContain("Vos enregistrements restent dans ./processed/.");
    expect(frame).toContain("Entrée créer le zip   Échap revenir au début");
  });

  it("calls onBack on Échap without calling the runner", async () => {
    const onBack = vi.fn();
    const { stdin, lastFrame } = renderConfirmScreen(neverCalled, { onBack });
    await waitForPreview(lastFrame);

    stdin.write("\x1b");
    await settle();

    expect(onBack).toHaveBeenCalledOnce();
  });

  it("does not mention an existing zip when the resolver reports none", async () => {
    const { lastFrame } = renderConfirmScreen(neverCalled);
    await waitForPreview(lastFrame);

    expect(lastFrame() ?? "").not.toContain("Un zip existe déjà");
  });

  it("mentions an existing zip when the resolver reports one", async () => {
    const resolveTargetName: ResolveTargetName = () =>
      Promise.resolve({ name: "processed_20260101.zip", alreadyExists: true });

    const { lastFrame } = renderConfirmScreen(neverCalled, {
      resolveTargetName,
    });
    await waitForPreview(lastFrame);

    expect(lastFrame() ?? "").toContain("Un zip existe déjà dans ./archived/");
  });
});

describe("ArchiveConfirmScreen — preview, package mode", () => {
  it("shows the singular wording and no ZIP64 warning when the batch fits one volume", async () => {
    const resolveTargetName: ResolveTargetName = () =>
      Promise.resolve({ name: "depot_20260101", alreadyExists: false });

    const { lastFrame } = renderConfirmScreen(neverCalled, {
      mode: "package",
      resolveTargetName,
      // sampleTotalBytes (12) is far below the default 3.5 GiB cap.
    });
    await waitForPreview(lastFrame);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("./upload/depot_20260101/");
    // Every sentence must agree with the single-file estimate — "de chacun"
    // and "tous en même temps" read as bugs when only one zip comes out.
    expect(frame).toContain("Taille :           au plus ");
    expect(frame).not.toContain("Taille de chacun");
    expect(frame).toContain("dans un fichier zip.");
    expect(frame).toContain("Le fichier zip n'apparaîtra qu'à la fin.");
    expect(frame).not.toContain(
      "Vigie-Chiro n'accepte pas les fichiers trop volumineux",
    );
    expect(frame).toContain("Entrée créer le zip");
  });

  it("shows the plural wording and the ZIP64 warning when the batch exceeds one volume", async () => {
    const resolveTargetName: ResolveTargetName = () =>
      Promise.resolve({ name: "depot_20260101", alreadyExists: false });

    const { lastFrame } = renderConfirmScreen(neverCalled, {
      mode: "package",
      resolveTargetName,
      totalBytes: 4 * 1024 ** 3, // 4 GiB > default 3.5 GiB cap
    });
    await waitForPreview(lastFrame);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("dans plusieurs fichiers zip.");
    expect(frame).toContain(
      "Vigie-Chiro n'accepte pas les fichiers trop volumineux",
    );
    expect(frame).toContain("Entrée créer les zips");
  });

  it("mentions an existing upload series when the resolver reports one", async () => {
    const resolveTargetName: ResolveTargetName = () =>
      Promise.resolve({ name: "depot_20260101", alreadyExists: true });

    const { lastFrame } = renderConfirmScreen(neverCalled, {
      mode: "package",
      resolveTargetName,
    });
    await waitForPreview(lastFrame);

    expect(lastFrame() ?? "").toContain(
      "Un dossier de dépôt existe déjà dans ./upload/",
    );
  });
});

describe("ArchiveConfirmScreen — Entrée triggers the run", () => {
  it("calls the runner then onComplete with the backup-ok outcome", async () => {
    const okResult: ArchiveRunnerResult = {
      kind: "backup-ok",
      zipPath: "/tmp/whatever/processed_20260101.zip",
      zipBytes: 999,
      entryCount: sampleEntries.length,
      durationMs: 42,
    };
    const { runner } = makeRecordingRunner(okResult);
    const onComplete = vi.fn();

    const { stdin, lastFrame } = renderConfirmScreen(runner, { onComplete });
    await waitForPreview(lastFrame);

    stdin.write("\r");
    await waitUntil(() => onComplete.mock.calls.length > 0);

    expect(onComplete).toHaveBeenCalledWith(okResult);
  });

  it("calls onComplete with the aborted outcome when the runner resolves aborted", async () => {
    const { runner } = makeRecordingRunner({ kind: "aborted" });
    const onComplete = vi.fn();

    const { stdin, lastFrame } = renderConfirmScreen(runner, { onComplete });
    await waitForPreview(lastFrame);

    stdin.write("\r");
    await waitUntil(() => onComplete.mock.calls.length > 0);

    expect(onComplete).toHaveBeenCalledWith({ kind: "aborted" });
  });
});

describe("ArchiveConfirmScreen — run-error", () => {
  it("shows the generic warning, the safety reassurance, the mapped French label, and the full untruncated raw code", async () => {
    const { runner } = makeRecordingRunner({ kind: "error", code: "ENOSPC" });

    const { stdin, lastFrame } = renderConfirmScreen(runner);
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

  it("offers Entrée réessayer for a transient code, and Entrée goes back to the confirmation preview", async () => {
    const { runner } = makeRecordingRunner({ kind: "error", code: "ENOSPC" });

    const { stdin, lastFrame } = renderConfirmScreen(runner);
    await waitForPreview(lastFrame);

    stdin.write("\r");
    await waitUntil(() =>
      (lastFrame() ?? "").includes(
        "Une erreur est survenue pendant la création du zip.",
      ),
    );
    await settle();

    expect(lastFrame() ?? "").toContain("Entrée réessayer");
    expect(lastFrame() ?? "").toContain(
      "(la création du zip reprend depuis le début)",
    );

    stdin.write("\r");
    await waitUntil(() => (lastFrame() ?? "").includes("dans un fichier zip."));

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Entrée créer le zip");
    expect(frame).not.toContain("Une erreur est survenue");
  });

  it("does not offer Entrée réessayer for a definitive code, and Entrée is a no-op", async () => {
    const { runner } = makeRecordingRunner({
      kind: "error",
      code: "entry-too-large",
    });

    const { stdin, lastFrame } = renderConfirmScreen(runner);
    await waitForPreview(lastFrame);

    stdin.write("\r");
    await waitUntil(() =>
      (lastFrame() ?? "").includes(
        "Une erreur est survenue pendant la création du zip.",
      ),
    );
    await settle();

    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("Entrée réessayer");
    expect(frame).not.toContain("reprend depuis le début");
    expect(frame).toContain("Échap revenir au début");

    stdin.write("\r");
    await settle();

    // Still on the run-error screen — Entrée had no effect for a definitive
    // code.
    expect(lastFrame() ?? "").toContain("Une erreur est survenue");
  });

  it("uses the upload-flavored title and dirLabel in package mode", async () => {
    const { runner } = makeRecordingRunner({
      kind: "error",
      code: "mkdir:EACCES",
    });

    const { stdin, lastFrame } = renderConfirmScreen(runner, {
      mode: "package",
    });
    await waitForPreview(lastFrame);

    stdin.write("\r");
    await waitUntil(() =>
      (lastFrame() ?? "").includes(
        "Une erreur est survenue pendant la préparation des fichiers zip.",
      ),
    );
    await settle();

    expect(lastFrame() ?? "").toContain("créer le sous-dossier « upload »");
  });
});

describe("ArchiveConfirmScreen — Ctrl+C during running enters the cleaning state", () => {
  it("shows the cleaning screen and ignores further input until the run settles", async () => {
    const { runner, getSignal, resolve } = makeManualRunner();

    const { stdin, lastFrame } = renderConfirmScreen(runner);
    await waitForPreview(lastFrame);

    stdin.write("\r");
    await waitUntil(() =>
      (lastFrame() ?? "").includes("Création du zip en cours…"),
    );

    expect(getSignal()?.aborted).toBe(false);

    stdin.write("\x03");
    await waitUntil(() => getSignal()?.aborted === true);

    expect(getSignal()?.aborted).toBe(true);
    await waitUntil(() => (lastFrame() ?? "").includes("Annulation en cours…"));
    expect(lastFrame() ?? "").toContain(
      "Nettoyage des fichiers temporaires, un instant.",
    );

    // Let the in-flight run settle so nothing dangles past the test.
    resolve({ kind: "aborted" });
  });
});
