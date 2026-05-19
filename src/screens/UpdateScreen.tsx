import { Box, Text, useInput } from "ink";
import { useEffect, useState } from "react";
import type { FetchResult } from "../lib/update/fetchLatestVersion.js";
import { fetchLatestVersion } from "../lib/update/fetchLatestVersion.js";
import { compareVersions } from "../lib/update/compareVersions.js";
import { parseVersion } from "../lib/update/parseVersion.js";
import { Footer } from "../components/Footer.js";
import {
  getErrorHint,
  getErrorLabel,
  getErrorTitle,
} from "./updateErrorMessages.js";
import type { UpdateErrorCode } from "./updateErrorMessages.js";

type LocalState =
  | { kind: "checking" }
  | { kind: "up-to-date" }
  | { kind: "available"; tagName: string }
  | { kind: "error"; code: UpdateErrorCode };

export type UpdateChecker = (opts?: {
  signal?: AbortSignal;
}) => Promise<FetchResult>;

export type UpdateScreenProps = {
  currentVersion: string;
  onBack: () => void;
  onRequestInstall: () => void;
  runningRef: React.RefObject<boolean>;
  /**
   * Test seam. Defaults to `fetchLatestVersion` (direct network call) —
   * intentionally bypasses the boot-time disk cache because the user just
   * clicked "Check for updates" and expects a fresh answer; freshness wins
   * over rate-limit avoidance.
   */
  checker?: UpdateChecker;
  autoUpdateDisabled?: boolean;
};

const resolveState = (
  result: FetchResult,
  currentVersion: string,
): LocalState => {
  if (result.kind === "error") {
    return { kind: "error", code: result.code };
  }

  const localParsed = parseVersion(currentVersion);
  if (localParsed === null) {
    return { kind: "error", code: "parse-local" };
  }

  const remoteParsed = parseVersion(result.tagName);
  if (remoteParsed === null) {
    return { kind: "error", code: "parse" };
  }

  const order = compareVersions(remoteParsed, localParsed);
  if (order > 0) {
    return { kind: "available", tagName: result.tagName };
  }
  return { kind: "up-to-date" };
};

export const UpdateScreen = ({
  currentVersion,
  onBack,
  onRequestInstall,
  runningRef,
  checker = fetchLatestVersion,
  autoUpdateDisabled = false,
}: UpdateScreenProps): React.JSX.Element => {
  const [state, setState] = useState<LocalState>({ kind: "checking" });

  useInput((_input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    if (key.return && state.kind === "available") {
      onRequestInstall();
    }
  });

  useEffect(() => {
    if (autoUpdateDisabled) return;
    runningRef.current = true;
    const controller = new AbortController();
    let cancelled = false;

    checker({ signal: controller.signal })
      .then((result) => {
        if (cancelled) return;
        setState(resolveState(result, currentVersion));
      })
      .catch(() => {
        if (cancelled) return;
        // Defensive: fetchLatestVersion contract says no throw, but a
        // future bug or a custom injected checker must not leave the
        // screen stuck in "checking" forever.
        setState({ kind: "error", code: "network" });
      })
      .finally(() => {
        if (!cancelled) runningRef.current = false;
      });

    return () => {
      cancelled = true;
      controller.abort();
      runningRef.current = false;
    };
  }, [checker, currentVersion, runningRef, autoUpdateDisabled]);

  const header = (
    <Text bold color="cyan">
      {`chiro v${currentVersion} — mise à jour`}
    </Text>
  );

  const backFooter = [{ key: "Échap", label: "retour au menu" }];
  const installFooter = [
    { key: "Entrée", label: "installer" },
    { key: "Échap", label: "retour au menu" },
  ];

  if (autoUpdateDisabled) {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        {header}
        <Box marginTop={1}>
          <Text>{"ℹ "}</Text>
          <Text>{"chiro a été installé via Homebrew sur cet ordinateur."}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>{"Les mises à jour passent donc par Homebrew."}</Text>
          <Text>{"Dans votre terminal, lancez :"}</Text>
          <Box marginTop={1} marginLeft={2}>
            <Text bold color="cyan">
              {"brew upgrade chiro"}
            </Text>
          </Box>
        </Box>
        <Footer hints={backFooter} />
      </Box>
    );
  }

  if (state.kind === "checking") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        {header}
        <Box marginTop={1}>
          <Text>{"Vérification de la dernière version…"}</Text>
        </Box>
        <Footer hints={backFooter} />
      </Box>
    );
  }

  if (state.kind === "up-to-date") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        {header}
        <Box marginTop={1}>
          <Text color="green">{"✓ "}</Text>
          <Text>{"Vous êtes à jour."}</Text>
        </Box>
        <Footer hints={backFooter} />
      </Box>
    );
  }

  if (state.kind === "available") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        {header}
        <Box marginTop={1}>
          <Text color="green">{"✓ "}</Text>
          <Text>{"Une nouvelle version est disponible : "}</Text>
          <Text color="cyan">{state.tagName}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>{"Sur Entrée, chiro lance l'installation puis se ferme."}</Text>
          <Text>
            {"Relancez chiro ensuite pour utiliser la nouvelle version."}
          </Text>
        </Box>
        <Footer hints={installFooter} />
      </Box>
    );
  }

  // state.kind === "error"
  const { code } = state;
  const title = getErrorTitle(code);
  const hint = getErrorHint(code);
  const label = getErrorLabel(code);

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
      {header}
      <Box marginTop={1}>
        <Text color="yellow">{"⚠ "}</Text>
        <Text>{title}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {hint.split("\n").map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
        <Text>{`Détail technique : ${label} (${code})`}</Text>
        <Text dimColor>{"  (à transmettre si vous demandez de l'aide)"}</Text>
      </Box>
      <Footer hints={backFooter} />
    </Box>
  );
};
