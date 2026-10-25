import { Box, Text, useInput } from "ink";
import path from "node:path";
import { useEffect, useRef, useState } from "react";
import { Footer } from "../../components/Footer.js";
import { describeError } from "../../lib/errors/describeError.js";
import type { ApplyOptions } from "../../lib/fs/applyRenames.js";
import { planRenames } from "../../lib/fs/planRenames.js";
import { buildVigiePrefixSessionEvent } from "../../lib/logging/buildVigiePrefixSessionEvent.js";
import { logSession } from "../../lib/logging/log.js";
import {
  oneOfEachPrefixFirst,
  summarizeFoundPrefixes,
} from "../../lib/vigie-chiro/foundPrefixes.js";
import { buildPrefix } from "../../lib/vigie-chiro/prefix.js";
import type { FormInput, RenameOutcome, RenamePlan } from "../../types.js";
import { mapKnownErrorCode } from "./errorMessages.js";

/**
 * Signature of the rename executor — extracted here so App can import it
 * without creating a circular dependency.
 */
export type ApplyRenamesFn = (
  plan: RenamePlan,
  dir: string,
  options?: ApplyOptions,
) => Promise<RenameOutcome>;
import { fitPath } from "../../format/path.js";

type ConfirmState =
  | { kind: "loading" }
  | { kind: "plan-ready"; plan: RenamePlan }
  | { kind: "running"; plan: RenamePlan }
  | { kind: "plan-error"; rawCode: string }
  | { kind: "run-error"; rawCode: string };

/**
 * Capitalizes the first letter and appends a trailing period — the mapper
 * wordings are calibrated lowercase for use as bullet points elsewhere.
 * "chiro" stays lowercase even sentence-initial (brand name convention,
 * cf. docs/ux.md — never capitalized, not even at the start of a sentence).
 */
const asSentence = (text: string): string => {
  if (text.startsWith("chiro")) return `${text}.`;
  const [first, ...rest] = text;
  if (first === undefined) return text;
  return `${first.toUpperCase()}${rest.join("")}.`;
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

const previewExamples = <T,>(items: readonly T[], limit: 1 | 2 | 3): T[] => {
  if (items.length <= limit + 1) return [...items];
  return limit === 3 ? pickExamples(items) : items.slice(0, limit);
};

const RemainingLine = ({
  count,
}: {
  count: number;
}): React.JSX.Element | null =>
  count > 0 ? (
    <Box marginTop={1}>
      <Text dimColor>
        {`  Les ${count.toString()} autres suivent le même format.`}
      </Text>
    </Box>
  ) : null;

export type ConfirmScreenProps = {
  cwd: string;
  input: FormInput;
  wavFiles: string[];
  /**
   * Toggle by ConfirmScreen during the rename run. Mutated, not state —
   * the global Ctrl+C handler in App reads `.current` synchronously.
   */
  runningRef: React.RefObject<boolean>;
  /** Injected rename implementation — allows mocking in tests. */
  applyRenames: ApplyRenamesFn;
  onComplete: (outcome: RenameOutcome) => void;
  onEditInput: () => void;
  onBackToConstat: () => void;
};

export const ConfirmScreen = ({
  cwd,
  input,
  wavFiles,
  runningRef,
  applyRenames,
  onComplete,
  onEditInput,
  onBackToConstat,
}: ConfirmScreenProps): React.JSX.Element => {
  const prefix = buildPrefix(input);
  const [state, setState] = useState<ConfirmState>({ kind: "loading" });
  const controllerRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void planRenames(wavFiles, prefix, cwd)
      .then((plan) => {
        if (cancelled) return;
        setState({ kind: "plan-ready", plan });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({ kind: "plan-error", rawCode: describeError(err) });
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
      if (key.escape) onBackToConstat();
      return;
    }
    if (key.escape) {
      onEditInput();
      return;
    }
    if (key.return) {
      void startRename(state.plan);
    }
  });

  const startRename = async (plan: RenamePlan) => {
    // Synchronous latch, not state: two Entrée events in the same tick would
    // otherwise both start a rename, and the second sees every target already
    // taken by the first — a Result screen full of EEXIST errors on a
    // rename that in fact succeeded. Same latch as `useArchiveRun`.
    if (startedRef.current) return;
    startedRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    runningRef.current = true;
    setState({ kind: "running", plan });

    let outcome: RenameOutcome;
    try {
      outcome = await applyRenames(plan, cwd, { signal: controller.signal });
    } catch (err) {
      runningRef.current = false;
      controllerRef.current = null;
      setState({ kind: "run-error", rawCode: describeError(err) });
      return;
    }

    try {
      await logSession(buildVigiePrefixSessionEvent(input, plan, outcome, cwd));
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

  if (state.kind === "run-error") {
    const knownMessage = mapKnownErrorCode(state.rawCode);
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
        <Box marginTop={1}>
          <Text color="yellow">
            ⚠ Une erreur est survenue pendant le renommage.
          </Text>
        </Box>
        {knownMessage !== null ? (
          <Box marginTop={1}>
            <Text>{asSentence(knownMessage)}</Text>
          </Box>
        ) : null}
        <Box marginTop={1} flexDirection="column">
          <Text>
            Détail technique : <Text color="cyan">{state.rawCode}</Text>
          </Text>
          <Text dimColor>{"  (à transmettre si vous demandez de l'aide)"}</Text>
        </Box>
        <Footer hints={[{ key: "Échap", label: "revenir au début" }]} />
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
  const prefixOps = plan.operations.filter((op) => op.kind === "prefix");
  const reprefixOps = plan.operations.filter((op) => op.kind === "reprefix");
  const whitespaceOps = plan.operations.filter(
    (op) => op.kind === "whitespace",
  );
  const collisionsCount = plan.skippedCollision.length;
  const alreadyCount = plan.skippedAlreadyPrefixed.length;
  const alreadyExamples = pickExamples(plan.skippedAlreadyPrefixed);
  const compact =
    [prefixOps, reprefixOps, whitespaceOps].filter((ops) => ops.length > 0)
      .length > 1;
  const whitespaceAlone =
    prefixOps.length === 0 &&
    reprefixOps.length === 0 &&
    collisionsCount === 0 &&
    alreadyCount === 0;
  const examples = compact
    ? prefixOps.slice(0, 1)
    : previewExamples(prefixOps, 3);
  const remaining = compact ? 0 : prefixOps.length - examples.length;
  const reprefixExamples = compact
    ? reprefixOps.slice(0, 1)
    : previewExamples(oneOfEachPrefixFirst(reprefixOps), 2);
  const reprefixRemaining = compact
    ? 0
    : reprefixOps.length - reprefixExamples.length;
  const foundPrefixes = summarizeFoundPrefixes(
    reprefixOps.map((op) => op.from),
    1,
  );
  const otherPrefixCount = foundPrefixes.count - 1;
  const whitespaceExamples = compact
    ? whitespaceOps.slice(0, 1)
    : previewExamples(whitespaceOps, whitespaceAlone ? 3 : 1);
  const whitespaceRemaining = compact
    ? 0
    : whitespaceOps.length - whitespaceExamples.length;
  const nothingButAlready =
    plan.operations.length === 0 && collisionsCount === 0 && alreadyCount > 0;

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
      <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
      {plan.operations.length === 0 && collisionsCount > 0 ? (
        <Box marginTop={1}>
          <Text color="cyan">ℹ Aucun fichier ne sera renommé.</Text>
        </Box>
      ) : nothingButAlready ? (
        <>
          <Box flexDirection="column" marginTop={1}>
            <Text color="cyan">
              {alreadyCount > 1
                ? `ℹ Les ${alreadyCount.toString()} fichiers portent déjà le préfixe`
                : "ℹ Le fichier porte déjà le préfixe"}
            </Text>
            <Text color="cyan">{`    ${prefix}`}</Text>
          </Box>
          <Box marginTop={1}>
            <Text>Rien à renommer.</Text>
          </Box>
        </>
      ) : prefixOps.length > 0 ? (
        <>
          <Box marginTop={1}>
            <Text>
              On va renommer {prefixOps.length.toString()} fichier
              {prefixOps.length > 1 ? "s" : ""} comme ceci :
            </Text>
          </Box>
          <Box flexDirection="column" marginTop={compact ? 0 : 1}>
            {examples.map((op, index) => (
              <Box
                key={op.from}
                flexDirection="column"
                marginTop={index > 0 ? 1 : 0}
              >
                <Text>{`  ${op.from}`}</Text>
                <Text>
                  {`    `}
                  <Text color="cyan">{`→ ${op.to}`}</Text>
                </Text>
              </Box>
            ))}
            <RemainingLine count={remaining} />
          </Box>
        </>
      ) : null}

      {reprefixOps.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">
            {reprefixOps.length > 1
              ? `⚠ ${reprefixOps.length.toString()} fichiers portent déjà un autre préfixe :`
              : "⚠ 1 fichier porte déjà un autre préfixe :"}
          </Text>
          <Text>
            <Text color="yellow">{`    ${foundPrefixes.prefixes.join("")}`}</Text>
            {otherPrefixCount > 0 ? (
              <Text dimColor>
                {otherPrefixCount > 1
                  ? `  et ${otherPrefixCount.toString()} autres préfixes`
                  : "  et 1 autre préfixe"}
              </Text>
            ) : null}
          </Text>
          <Text>{"  L'ancien préfixe sera remplacé par le nouveau :"}</Text>
          {reprefixExamples.map((op) => (
            <Box
              key={op.from}
              flexDirection="column"
              marginTop={compact ? 0 : 1}
            >
              <Text>{`    ${path.basename(op.from)}`}</Text>
              <Text>
                {"  "}
                <Text color="cyan">{`→ ${path.basename(op.to)}`}</Text>
              </Text>
            </Box>
          ))}
          <RemainingLine count={reprefixRemaining} />
        </Box>
      ) : null}

      {whitespaceOps.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            {whitespaceOps.length > 1
              ? `Les espaces deviendront « _ » dans ${whitespaceOps.length.toString()} fichiers déjà préfixés :`
              : "Les espaces deviendront « _ » dans 1 fichier déjà préfixé :"}
          </Text>
          {whitespaceExamples.map((op) => (
            <Box
              key={op.from}
              flexDirection="column"
              marginTop={compact ? 0 : 1}
            >
              <Text>{`    ${path.basename(op.from)}`}</Text>
              <Text>
                {"  "}
                <Text color="cyan">{`→ ${path.basename(op.to)}`}</Text>
              </Text>
            </Box>
          ))}
          <RemainingLine count={whitespaceRemaining} />
        </Box>
      ) : null}

      {collisionsCount > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">
            {collisionsCount > 1
              ? `⚠ ${collisionsCount.toString()} fichiers ne pourront pas être renommés`
              : "⚠ 1 fichier ne pourra pas être renommé"}
          </Text>
          <Text color="yellow">
            {"  (un fichier porte déjà le nom cible) :"}
          </Text>
          {pickExamples(plan.skippedCollision).map((name) => (
            <Text key={name}>{`    ${name}`}</Text>
          ))}
        </Box>
      ) : null}

      {alreadyCount > 0 &&
      (plan.operations.length > 0 || collisionsCount > 0) ? (
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

      {nothingButAlready ? null : (
        <Box marginTop={1}>
          <Text dimColor>
            {prefixOps.length === 0 &&
            reprefixOps.length === 0 &&
            whitespaceOps.length > 0
              ? "Seuls les espaces changent : le reste du nom est conservé."
              : "Le nom original est conservé en fin du nouveau nom — rien n'est perdu, vous pouvez retrouver chaque fichier à partir de sa fin."}
          </Text>
        </Box>
      )}

      <Footer
        hints={
          plan.operations.length === 0
            ? [
                { key: "Entrée", label: "continuer" },
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
