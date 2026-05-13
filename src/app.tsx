import { useApp, useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import {
  processWavFiles as defaultProcessWavFiles,
  type SoxContext,
} from "./lib/audio/processWavFiles.js";
import { detectSox, type SoxAvailability } from "./lib/audio/soxFastPath.js";
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
    };

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
  /** Called when the user confirms an update install; must be synchronous. */
  onRequestUpdate: () => void;
  /** Test seam for the boot auto-check. Defaults to real checkForUpdate. */
  bootChecker?: BootChecker;
  /** Test seam forwarded to UpdateScreen. Defaults to real fetchLatestVersion. */
  updateChecker?: UpdateChecker;
  /** Test seam for sox detection. When provided, detectSox is not called. */
  soxAvailability?: SoxAvailability;
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
  onRequestUpdate,
  bootChecker,
  updateChecker,
  soxAvailability: soxAvailabilityProp,
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
  }, [bootChecker]);

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
        onPickVigiePrefix={() => {
          setScreen({ kind: "vigie:constat" });
        }}
        onPickVigieProcess={() => {
          setScreen({ kind: "process:constat" });
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

  // screen.kind === "process:result"
  return (
    <ProcessResultScreen
      outcome={screen.outcome}
      onBackToMenu={() => {
        setScreen({ kind: "menu" });
      }}
    />
  );
};
