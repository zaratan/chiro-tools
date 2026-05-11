import { Box, Text, useApp, useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import { Footer } from "../../components/Footer.js";
import { applyRenames } from "../../lib/fs/applyRenames.js";
import { planRenames } from "../../lib/fs/planRenames.js";
import { logSession } from "../../lib/logging/log.js";
import { buildPrefix } from "../../lib/vigie-chiro/prefix.js";
import type {
  FormInput,
  RenameOutcome,
  RenamePlan,
  SessionEvent,
} from "../../types.js";
import { CHIRO_VERSION } from "../../version.js";

type ConfirmState =
  | { kind: "loading" }
  | { kind: "plan-ready"; plan: RenamePlan }
  | { kind: "running"; plan: RenamePlan }
  | { kind: "plan-error"; rawCode: string };

const extractErrorCode = (err: unknown): string => {
  if (
    err instanceof Error &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string"
  ) {
    return (err as { code: string }).code;
  }
  return "UNKNOWN";
};

const pickExamples = <T,>(items: readonly T[]): T[] => {
  if (items.length <= 3) return [...items];
  const first = items[0];
  const middle = items[Math.floor(items.length / 2)];
  const last = items[items.length - 1];
  if (first === undefined || middle === undefined || last === undefined) {
    return [...items];
  }
  return [first, middle, last];
};

const buildSessionEvent = (
  input: FormInput,
  outcome: RenameOutcome,
  cwd: string,
): SessionEvent => ({
  schema_version: 1,
  ts: new Date().toISOString(),
  version: CHIRO_VERSION,
  cwd,
  action: "vigie-prefix",
  input,
  result: {
    renamed: outcome.renamed.length,
    skipped_already_prefixed: outcome.skippedAlreadyPrefixed.length,
    skipped_collision: outcome.skippedCollision.length,
    errored: outcome.errored,
    interrupted: outcome.interrupted,
    duration_ms: outcome.durationMs,
  },
});

export type ConfirmScreenProps = {
  cwd: string;
  input: FormInput;
  wavFiles: string[];
  /**
   * Toggle by ConfirmScreen during the rename run. Mutated, not state —
   * the global Ctrl+C handler in App reads `.current` synchronously.
   */
  runningRef: React.RefObject<boolean>;
  onComplete: (outcome: RenameOutcome) => void;
  onBack: () => void;
};

export const ConfirmScreen = ({
  cwd,
  input,
  wavFiles,
  runningRef,
  onComplete,
  onBack,
}: ConfirmScreenProps): React.JSX.Element => {
  const prefix = buildPrefix(input);
  const [state, setState] = useState<ConfirmState>({ kind: "loading" });
  const controllerRef = useRef<AbortController | null>(null);
  const { exit: _exit } = useApp();

  useEffect(() => {
    let cancelled = false;
    void planRenames(wavFiles, prefix, cwd)
      .then((plan) => {
        if (cancelled) return;
        setState({ kind: "plan-ready", plan });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ kind: "plan-error", rawCode: extractErrorCode(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [cwd, prefix, wavFiles]);

  // Cleanup on unmount: abort any in-flight rename, clear runningRef.
  useEffect(() => {
    return () => {
      if (controllerRef.current) {
        controllerRef.current.abort();
      }
      runningRef.current = false;
    };
  }, [runningRef]);

  useInput((input2, key) => {
    if (state.kind === "running") {
      if (key.ctrl && input2 === "c") {
        controllerRef.current?.abort();
      }
      return;
    }
    if (state.kind !== "plan-ready") {
      if (key.escape) onBack();
      return;
    }
    if (key.escape) {
      onBack();
      return;
    }
    if (key.return) {
      void startRename(state.plan);
    }
  });

  const startRename = async (plan: RenamePlan) => {
    const controller = new AbortController();
    controllerRef.current = controller;
    runningRef.current = true;
    setState({ kind: "running", plan });
    const outcome = await applyRenames(plan, cwd, {
      signal: controller.signal,
    });
    try {
      await logSession(buildSessionEvent(input, outcome, cwd));
    } catch {
      // Local log is best-effort — never block the UI on a write failure.
    }
    runningRef.current = false;
    controllerRef.current = null;
    onComplete(outcome);
  };

  if (state.kind === "loading") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text dimColor>Préparation du plan…</Text>
      </Box>
    );
  }

  if (state.kind === "plan-error") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text color="yellow">
          ⚠ Impossible de préparer le plan de renommage.
        </Text>
        <Box marginTop={1}>
          <Text>
            Détail technique : <Text color="cyan">{state.rawCode}</Text>
          </Text>
        </Box>
        <Footer hints={[{ key: "Échap", label: "retour" }]} />
      </Box>
    );
  }

  if (state.kind === "running") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text dimColor>
          Renommage en cours… ({state.plan.operations.length.toString()} fichier
          {state.plan.operations.length > 1 ? "s" : ""})
        </Text>
        <Footer hints={[]} />
      </Box>
    );
  }

  // state.kind === "plan-ready"
  const { plan } = state;
  const examples = pickExamples(plan.operations);
  const remaining = Math.max(0, plan.operations.length - examples.length);
  const collisionsCount = plan.skippedCollision.length;
  const alreadyCount = plan.skippedAlreadyPrefixed.length;
  const alreadyExamples = pickExamples(plan.skippedAlreadyPrefixed);

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
      <Text>📁 {cwd}</Text>
      {plan.operations.length === 0 ? (
        <Box marginTop={1}>
          <Text color="cyan">
            ℹ Tous les fichiers ({alreadyCount.toString()}) sont déjà au bon
            format.
          </Text>
        </Box>
      ) : (
        <>
          <Box marginTop={1}>
            <Text>
              On va renommer {plan.operations.length.toString()} fichier
              {plan.operations.length > 1 ? "s" : ""} comme ceci :
            </Text>
          </Box>
          <Box flexDirection="column" marginTop={1}>
            {examples.map((op) => (
              <Box key={op.from} flexDirection="column" marginBottom={1}>
                <Text>{`  ${op.from}`}</Text>
                <Text>
                  {`    `}
                  <Text color="cyan">{`→ ${op.to}`}</Text>
                </Text>
              </Box>
            ))}
            {remaining > 0 ? (
              <Text dimColor>
                {`  Les ${remaining.toString()} autres suivent le même format (seul l'horodatage change).`}
              </Text>
            ) : null}
          </Box>
        </>
      )}

      {collisionsCount > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">
            ⚠ {collisionsCount.toString()} fichier
            {collisionsCount > 1 ? "s" : ""} ne pourra
            {collisionsCount > 1 ? "ont" : ""} pas être renommé
            {collisionsCount > 1 ? "s" : ""} (un fichier porte déjà le nom
            cible) :
          </Text>
          {pickExamples(plan.skippedCollision).map((name) => (
            <Text key={name}>{`    ${name}`}</Text>
          ))}
        </Box>
      ) : null}

      {alreadyCount > 0 && plan.operations.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="cyan">
            ℹ {alreadyCount.toString()} fichier
            {alreadyCount > 1
              ? "s seront laissés tels quels"
              : " sera laissé tel quel"}{" "}
            (déjà au bon format) :
          </Text>
          {alreadyExamples.map((name) => (
            <Text key={name}>{`    ${name}`}</Text>
          ))}
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text dimColor>
          Le nom original est conservé en fin du nouveau nom — rien n'est perdu,
          vous pouvez retrouver chaque fichier à partir de sa fin.
        </Text>
      </Box>

      <Footer
        hints={
          plan.operations.length === 0
            ? [
                { key: "Entrée", label: "retour au menu" },
                { key: "Échap", label: "retour à la saisie" },
              ]
            : [
                { key: "Entrée", label: "renommer" },
                { key: "Échap", label: "modifier la saisie" },
              ]
        }
      />
    </Box>
  );
};
