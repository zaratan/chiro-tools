import { useApp, useInput } from "ink";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  processWavFiles as defaultProcessWavFiles,
  type SoxContext,
} from "./lib/audio/processWavFiles.js";
import { type SoxAvailability } from "./lib/audio/detectSox.js";
import { detectSox } from "./lib/audio/detectSox.js";
import { createZipArchive as defaultCreateZipArchive } from "./lib/archive/createZipArchive.js";
import { createZipVolumes as defaultCreateZipVolumes } from "./lib/archive/createZipVolumes.js";
import {
  buildArchivedDir,
  type ArchiveEntryStat,
} from "./lib/archive/planArchive.js";
import { buildUploadDir } from "./lib/archive/planUpload.js";
import { buildOutDir } from "./lib/audio/batchPlan.js";
import { applyRenames as defaultApplyRenames } from "./lib/fs/applyRenames.js";
import { checkForUpdate } from "./lib/update/checkForUpdate.js";
import type { UpdateChecker } from "./screens/UpdateScreen.js";
import { MenuScreen } from "./screens/MenuScreen.js";
import { UpdateScreen } from "./screens/UpdateScreen.js";
import {
  ConfirmScreen,
  type ApplyRenamesFn,
} from "./screens/vigie-chiro/ConfirmScreen.js";
import { ConstatScreen } from "./screens/vigie-chiro/ConstatScreen.js";
import { FormScreen } from "./screens/vigie-chiro/FormScreen.js";
import { ResultScreen } from "./screens/vigie-chiro/ResultScreen.js";
import {
  ConfirmScreen as ProcessConfirmScreen,
  type ProcessWavFilesFn,
} from "./screens/vigie-process/ConfirmScreen.js";
import { ConstatScreen as ProcessConstatScreen } from "./screens/vigie-process/ConstatScreen.js";
import { ConfirmScreen as ArchiveConfirmScreen } from "./screens/archive/ConfirmScreen.js";
import { ConstatScreen as ArchiveConstatScreen } from "./screens/archive/ConstatScreen.js";
import { ResultScreen as ArchiveResultScreen } from "./screens/archive/ResultScreen.js";
import { UploadResultScreen } from "./screens/archive/UploadResultScreen.js";
import {
  createBackupBehavior,
  type CreateZipArchiveFn,
} from "./screens/archive/backupBehavior.js";
import {
  createPackageBehavior,
  type CreateZipVolumesFn,
} from "./screens/archive/packageBehavior.js";
import type {
  ArchiveRunOutcome,
  BackupOkResult,
  PackageOkResult,
} from "./screens/archive/useArchiveRun.js";
import { FormScreen as ProcessFormScreen } from "./screens/vigie-process/FormScreen.js";
import { ResultScreen as ProcessResultScreen } from "./screens/vigie-process/ResultScreen.js";
import type {
  ConstatCounts,
  FormInput,
  ProcessInput,
  RenameOutcome,
} from "./types.js";
import type { ProcessResult } from "./lib/audio/processWavFiles.js";
import { CHIRO_VERSION } from "./version.js";

type BackupOutcome = ArchiveRunOutcome<BackupOkResult>;
type PackageOutcome = ArchiveRunOutcome<PackageOkResult>;

type Screen =
  | { kind: "menu" }
  | { kind: "update" }
  | { kind: "vigie:constat" }
  | {
      kind: "vigie:form";
      constatCounts: ConstatCounts;
      wavFiles: string[];
    }
  | {
      kind: "vigie:confirm";
      input: FormInput;
      wavFiles: string[];
    }
  | {
      kind: "vigie:result";
      input: FormInput;
      outcome: RenameOutcome;
    }
  | { kind: "process:constat" }
  | { kind: "process:form"; wavFiles: string[] }
  | {
      kind: "process:confirm";
      input: ProcessInput;
      wavFiles: string[];
    }
  | {
      kind: "process:result";
      input: ProcessInput;
      outcome: ProcessResult;
    }
  | { kind: "archive:constat" }
  | {
      kind: "archive:confirm";
      entries: ArchiveEntryStat[];
      totalBytes: number;
    }
  | { kind: "archive:result"; outcome: BackupOutcome }
  | { kind: "package:constat" }
  | {
      kind: "package:confirm";
      entries: ArchiveEntryStat[];
      totalBytes: number;
    }
  | { kind: "package:result"; outcome: PackageOutcome };

type BootChecker = (opts: {
  currentVersion: string;
  signal?: AbortSignal;
}) => Promise<{ availableVersion: string | null }>;

export type AppProps = {
  cwd: string;
  /** Override for tests. Defaults to the real implementation. */
  applyRenames?: ApplyRenamesFn;
  /** Override for tests. Defaults to the real implementation. */
  processWavFiles?: ProcessWavFilesFn;
  /** Override for tests. Defaults to the real implementation. */
  createZipArchive?: CreateZipArchiveFn;
  /** Override for tests. Defaults to the real implementation. */
  createZipVolumes?: CreateZipVolumesFn;
  /** Called when the user confirms an update install; must be synchronous. */
  onRequestUpdate: () => void;
  /** Test seam for the boot auto-check. Defaults to real checkForUpdate. */
  bootChecker?: BootChecker;
  /** Test seam forwarded to UpdateScreen. Defaults to real fetchLatestVersion. */
  updateChecker?: UpdateChecker;
  /** Test seam for sox detection. When provided, detectSox is not called. */
  soxAvailability?: SoxAvailability;
  /** When true, the auto-updater is disabled: boot check skipped,
   *  menu entry hidden, update screen shows a "managed externally" message.
   *  Set when chiro runs from Homebrew or when CHIRO_DISABLE_AUTOUPDATE=1. */
  autoUpdateDisabled?: boolean;
};

const buildProcessWavFiles = (
  base: ProcessWavFilesFn,
  sox: SoxContext | undefined,
): ProcessWavFilesFn => {
  if (sox === undefined) return base;
  return (files, dir, input, options) =>
    base(files, dir, input, { ...options, sox });
};

export const App = ({
  cwd,
  applyRenames = defaultApplyRenames,
  processWavFiles: processWavFilesProp = defaultProcessWavFiles,
  createZipArchive = defaultCreateZipArchive,
  createZipVolumes = defaultCreateZipVolumes,
  onRequestUpdate,
  bootChecker,
  updateChecker,
  soxAvailability: soxAvailabilityProp,
  autoUpdateDisabled = false,
}: AppProps): React.JSX.Element => {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>({ kind: "menu" });
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const [soxAvailability, setSoxAvailability] = useState<
    SoxAvailability | "pending"
  >(soxAvailabilityProp ?? "pending");
  // Ref consulted by the global Ctrl+C handler. When true, Ctrl+C is ignored
  // at this level (ConfirmScreen handles it locally during a running rename
  // batch). When false, Ctrl+C exits the program cleanly.
  const runningRef = useRef<boolean>(false);

  // The backup/package behavior triplets ("app.tsx choisit le triplet au
  // routage"), memoized so their closures keep a stable
  // identity across renders unrelated to this screen (e.g. the boot update
  // check resolving while the user sits on the confirmation screen) — a
  // fresh closure identity every render would otherwise re-trigger
  // `useArchiveRun`'s preview-resolution effect on every unrelated
  // re-render. Built unconditionally (never inside an `if (screen.kind ===
  // ...)` branch) to respect the Rules of Hooks; harmlessly unused with an
  // empty entries array when the matching screen isn't active.
  const backupEntries =
    screen.kind === "archive:confirm" ? screen.entries : null;
  const backupBehavior = useMemo(
    () =>
      createBackupBehavior(
        buildOutDir(cwd),
        buildArchivedDir(cwd),
        backupEntries ?? [],
        createZipArchive,
      ),
    [cwd, backupEntries, createZipArchive],
  );

  const packageEntries =
    screen.kind === "package:confirm" ? screen.entries : null;
  const packageBehavior = useMemo(
    () =>
      createPackageBehavior(
        buildOutDir(cwd),
        buildUploadDir(cwd),
        packageEntries ?? [],
        createZipVolumes,
      ),
    [cwd, packageEntries, createZipVolumes],
  );

  const soxContext: SoxContext | undefined =
    soxAvailability !== "pending" && soxAvailability.kind === "available"
      ? { binPath: soxAvailability.binPath }
      : undefined;

  const processWavFiles = buildProcessWavFiles(processWavFilesProp, soxContext);

  useEffect(() => {
    if (soxAvailabilityProp !== undefined) return;
    let cancelled = false;
    void detectSox()
      .then((availability) => {
        if (cancelled) return;
        setSoxAvailability(availability);
      })
      .catch(() => {
        if (cancelled) return;
        setSoxAvailability({ kind: "absent" });
      });
    return () => {
      cancelled = true;
    };
  }, [soxAvailabilityProp]);

  useEffect(() => {
    if (autoUpdateDisabled) return;
    const controller = new AbortController();
    let cancelled = false;

    const runCheck = bootChecker
      ? bootChecker({
          currentVersion: CHIRO_VERSION,
          signal: controller.signal,
        })
      : checkForUpdate({
          currentVersion: CHIRO_VERSION,
          signal: controller.signal,
        });

    void runCheck
      .then((result) => {
        if (cancelled) return;
        if (result.availableVersion !== null) {
          setAvailableVersion(result.availableVersion);
        }
      })
      .catch(() => {
        // Silent fail — boot check must never surface errors
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [bootChecker, autoUpdateDisabled]);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (runningRef.current) return;
      exit();
      process.exit(130);
    }
  });

  if (screen.kind === "menu") {
    return (
      <MenuScreen
        availableVersion={availableVersion}
        autoUpdateDisabled={autoUpdateDisabled}
        onPickVigiePrefix={() => {
          setScreen({ kind: "vigie:constat" });
        }}
        onPickVigieProcess={() => {
          setScreen({ kind: "process:constat" });
        }}
        onPickPackage={() => {
          setScreen({ kind: "package:constat" });
        }}
        onPickBackup={() => {
          setScreen({ kind: "archive:constat" });
        }}
        onPickUpdate={() => {
          setScreen({ kind: "update" });
        }}
        onQuit={() => {
          exit();
        }}
      />
    );
  }

  if (screen.kind === "update") {
    return (
      <UpdateScreen
        currentVersion={CHIRO_VERSION}
        autoUpdateDisabled={autoUpdateDisabled}
        onBack={() => {
          setScreen({ kind: "menu" });
        }}
        onRequestInstall={() => {
          onRequestUpdate();
          exit();
        }}
        runningRef={runningRef}
        checker={updateChecker}
      />
    );
  }

  if (screen.kind === "vigie:constat") {
    return (
      <ConstatScreen
        cwd={cwd}
        onContinue={(constatCounts, wavFiles) => {
          setScreen({ kind: "vigie:form", constatCounts, wavFiles });
        }}
        onBack={() => {
          setScreen({ kind: "menu" });
        }}
      />
    );
  }

  if (screen.kind === "vigie:form") {
    const { wavFiles } = screen;
    return (
      <FormScreen
        onSubmit={(input: FormInput) => {
          setScreen({ kind: "vigie:confirm", input, wavFiles });
        }}
        onBack={() => {
          setScreen({ kind: "vigie:constat" });
        }}
      />
    );
  }

  if (screen.kind === "vigie:confirm") {
    return (
      <ConfirmScreen
        cwd={cwd}
        input={screen.input}
        wavFiles={screen.wavFiles}
        runningRef={runningRef}
        applyRenames={applyRenames}
        onComplete={(outcome) => {
          setScreen({
            kind: "vigie:result",
            input: screen.input,
            outcome,
          });
        }}
        onBack={() => {
          setScreen({ kind: "vigie:constat" });
        }}
      />
    );
  }

  if (screen.kind === "vigie:result") {
    return (
      <ResultScreen
        input={screen.input}
        outcome={screen.outcome}
        onBackToMenu={() => {
          setScreen({ kind: "menu" });
        }}
      />
    );
  }

  if (screen.kind === "process:constat") {
    return (
      <ProcessConstatScreen
        cwd={cwd}
        onContinue={(wavFiles) => {
          setScreen({ kind: "process:form", wavFiles });
        }}
        onBack={() => {
          setScreen({ kind: "menu" });
        }}
      />
    );
  }

  if (screen.kind === "process:form") {
    const { wavFiles } = screen;
    return (
      <ProcessFormScreen
        onSubmit={(input) => {
          setScreen({ kind: "process:confirm", input, wavFiles });
        }}
        onBack={() => {
          setScreen({ kind: "process:constat" });
        }}
      />
    );
  }

  if (screen.kind === "process:confirm") {
    return (
      <ProcessConfirmScreen
        cwd={cwd}
        input={screen.input}
        wavFiles={screen.wavFiles}
        runningRef={runningRef}
        processWavFiles={processWavFiles}
        onComplete={(outcome) => {
          setScreen({
            kind: "process:result",
            input: screen.input,
            outcome,
          });
        }}
        onBack={() => {
          setScreen({ kind: "process:constat" });
        }}
      />
    );
  }

  if (screen.kind === "process:result") {
    return (
      <ProcessResultScreen
        outcome={screen.outcome}
        onBackToMenu={() => {
          setScreen({ kind: "menu" });
        }}
      />
    );
  }

  if (screen.kind === "archive:constat") {
    return (
      <ArchiveConstatScreen
        mode="backup"
        cwd={cwd}
        onContinue={(entries, totalBytes) => {
          setScreen({ kind: "archive:confirm", entries, totalBytes });
        }}
        onBack={() => {
          setScreen({ kind: "menu" });
        }}
      />
    );
  }

  if (screen.kind === "archive:confirm") {
    return (
      <ArchiveConfirmScreen
        mode="backup"
        cwd={cwd}
        entries={screen.entries}
        totalBytes={screen.totalBytes}
        runningRef={runningRef}
        runner={backupBehavior.runner}
        resolveTargetName={backupBehavior.resolveTargetName}
        buildSessionEvent={backupBehavior.buildSessionEvent}
        onComplete={(outcome) => {
          setScreen({ kind: "archive:result", outcome });
        }}
        onBack={() => {
          setScreen({ kind: "archive:constat" });
        }}
      />
    );
  }

  if (screen.kind === "archive:result") {
    return (
      <ArchiveResultScreen
        cwd={cwd}
        outcome={screen.outcome}
        onBackToMenu={() => {
          setScreen({ kind: "menu" });
        }}
      />
    );
  }

  if (screen.kind === "package:constat") {
    return (
      <ArchiveConstatScreen
        mode="package"
        cwd={cwd}
        onContinue={(entries, totalBytes) => {
          setScreen({ kind: "package:confirm", entries, totalBytes });
        }}
        onBack={() => {
          setScreen({ kind: "menu" });
        }}
      />
    );
  }

  if (screen.kind === "package:confirm") {
    return (
      <ArchiveConfirmScreen
        mode="package"
        cwd={cwd}
        entries={screen.entries}
        totalBytes={screen.totalBytes}
        runningRef={runningRef}
        runner={packageBehavior.runner}
        resolveTargetName={packageBehavior.resolveTargetName}
        buildSessionEvent={packageBehavior.buildSessionEvent}
        onComplete={(outcome) => {
          setScreen({ kind: "package:result", outcome });
        }}
        onBack={() => {
          setScreen({ kind: "package:constat" });
        }}
      />
    );
  }

  // screen.kind === "package:result"
  return (
    <UploadResultScreen
      cwd={cwd}
      outcome={screen.outcome}
      onBackToMenu={() => {
        setScreen({ kind: "menu" });
      }}
    />
  );
};
