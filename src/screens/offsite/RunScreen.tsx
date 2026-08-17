import { useInput } from "ink";
import type { ChosenArchive } from "../../lib/offsite/pickArchiveToUpload.js";
import type { OffsiteSettings } from "../../lib/offsite/settings.js";
import { ResultScreen } from "./ResultScreen.js";
import { RunningView } from "./RunningView.js";
import {
  useOffsiteRun,
  type OffsiteRunOutcome,
  type UploadArchiveFn,
} from "./useOffsiteRun.js";

export type OffsiteRunScreenProps = {
  cwd: string;
  chosen: ChosenArchive;
  binPath: string;
  settings: OffsiteSettings;
  /** Mutated during the run; consulted by the App-level Ctrl+C handler. */
  runningRef: React.RefObject<boolean>;
  platform?: NodeJS.Platform;
  /** Injected for tests. Defaults to the real `uploadArchive`. */
  uploadArchive?: UploadArchiveFn;
  /** Terminal outcomes only (`ok`/`aborted`) — `app.tsx` owns the
   * transition to `offsite:result` for those. A `run-error` never reaches
   * here: it's rendered in place, below. */
  onComplete: (outcome: OffsiteRunOutcome) => void;
  /** "Échap" from a run-error screen — back to the confirmation, not the
   * menu: `chosen` is already known, no need to redo the constat. */
  onBackToStart: () => void;
};

/**
 * Owns `useOffsiteRun` for the running screen, playing the role
 * `archive/ConfirmScreen.tsx` plays for its own flow: the hook's lifecycle
 * (mount-to-start, abort-on-unmount) needs to be tied to a component that
 * actually mounts and unmounts with navigation — which a route switch in
 * `app.tsx` provides, and calling the hook unconditionally at `app.tsx`'s
 * top level would not (it would run for every screen, with no `chosen` to
 * run it against outside this flow).
 *
 * Split from `offsite/ConfirmScreen.tsx` rather than folded into it (unlike
 * the other three flows, where confirmation and run share one file):
 * `ConfirmScreen.tsx` was already delivered in 10.B1 as a stateless
 * confirmation view with its own tests, and this flow's plan lists
 * `RunningView`/`ResultScreen`/`useOffsiteRun` as separate files rather than
 * a state machine folded into the confirmation screen. This file is the
 * connective tissue the plan didn't name but the architecture requires —
 * see the final report.
 *
 * A run-error is rendered here, in place: `retry()` restarts the same
 * transfer without leaving this screen or re-running the constat. Success
 * and abandonment are terminal, so they leave through `onComplete` instead.
 */
export const RunScreen = ({
  cwd,
  chosen,
  binPath,
  settings,
  runningRef,
  platform,
  uploadArchive,
  onComplete,
  onBackToStart,
}: OffsiteRunScreenProps): React.JSX.Element => {
  const { state, abort, retry, registerRunningViewHandles } = useOffsiteRun({
    cwd,
    chosen,
    binPath,
    settings,
    runningRef,
    platform,
    uploadArchive,
    onComplete,
  });

  useInput((input, key) => {
    if (state.kind === "running" && key.ctrl && input === "c") {
      abort();
    }
  });

  if (state.kind === "run-error") {
    return (
      <ResultScreen
        cwd={cwd}
        outcome={{
          kind: "run-error",
          code: state.code,
          zipBytes: state.zipBytes,
        }}
        // Never fires from a run-error outcome (see ResultScreen's own
        // useInput) — a value is required by the prop, not by any reachable
        // interaction, so reusing onBackToStart costs nothing.
        onBackToMenu={onBackToStart}
        onRetry={retry}
        onBackToStart={onBackToStart}
      />
    );
  }

  return (
    <RunningView
      cwd={cwd}
      chosen={chosen}
      stopping={state.kind === "stopping"}
      onMount={registerRunningViewHandles}
    />
  );
};
