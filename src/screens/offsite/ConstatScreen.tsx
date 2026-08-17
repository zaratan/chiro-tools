import { Box, Text, useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import { Footer } from "../../components/Footer.js";
import {
  ARCHIVED_DIR_DISPLAY,
  buildArchivedDir,
} from "../../lib/archive/planArchive.js";
import { formatBytes } from "../../format/bytes.js";
import { formatDayMonth, formatDayMonthYear } from "../../format/date.js";
import { fitPath } from "../../format/path.js";
import {
  pickArchiveToUpload as defaultPickArchiveToUpload,
  type ChosenArchive,
  type PickArchiveResult,
} from "../../lib/offsite/pickArchiveToUpload.js";
import {
  remoteStat as defaultRemoteStat,
  type RemoteStatDeps,
  type RemoteStatParams,
  type RemoteStatResult,
} from "../../lib/offsite/remoteStat.js";
import type { OffsiteSettings } from "../../lib/offsite/settings.js";
import {
  isTransientOffsiteError,
  mapKnownOffsiteErrorCode,
} from "./errorMessages.js";

export type PickArchiveToUploadFn = (
  archivedDir: string,
  signal?: AbortSignal,
) => Promise<PickArchiveResult>;

export type RemoteStatFn = (
  deps: RemoteStatDeps,
  params: RemoteStatParams,
) => Promise<RemoteStatResult>;

type ConstatState =
  | { kind: "loading-local" }
  | { kind: "loading-remote"; chosen: ChosenArchive; otherCount: number }
  | { kind: "no-backup" }
  | { kind: "scan-error"; rawCode: string }
  | { kind: "ready"; chosen: ChosenArchive; otherCount: number }
  | { kind: "already-online"; chosen: ChosenArchive; modTime: string }
  | { kind: "size-mismatch"; chosen: ChosenArchive; remoteBytes: number }
  | { kind: "verify-error"; chosen: ChosenArchive; code: string };

/**
 * Runs the two-phase probe (local pick, then remote HEAD) and returns the
 * terminal state — or `null` when aborted, which the caller's `cancelled`
 * flag already discards before it would reach `setState`.
 *
 * `onPhaseChange` reports the intermediate `loading-remote` transition,
 * since this is the one screen in the app with a real two-step wait: the
 * local scan is near-instant, but the remote HEAD can hang on a slow link
 * (bounded by `remoteStat`'s own short timeouts).
 */
const scanArchived = async (
  cwd: string,
  binPath: string,
  settings: OffsiteSettings,
  pick: PickArchiveToUploadFn,
  stat: RemoteStatFn,
  signal: AbortSignal,
  onPhaseChange: (state: ConstatState) => void,
): Promise<ConstatState | null> => {
  const archivedDir = buildArchivedDir(cwd);
  const picked = await pick(archivedDir, signal);

  if (picked.kind === "aborted") return null;
  if (picked.kind === "none") return { kind: "no-backup" };
  if (picked.kind === "error") {
    return { kind: "scan-error", rawCode: picked.code };
  }

  const { chosen, otherCount } = picked;
  onPhaseChange({ kind: "loading-remote", chosen, otherCount });

  const result = await stat(
    { binPath },
    { settings, key: chosen.name, signal },
  );

  if (result.kind === "aborted") return null;
  if (result.kind === "absent") return { kind: "ready", chosen, otherCount };
  if (result.kind === "present") {
    if (result.bytes === chosen.size) {
      return { kind: "already-online", chosen, modTime: result.modTime };
    }
    return { kind: "size-mismatch", chosen, remoteBytes: result.bytes };
  }
  // result.kind is "bucket-missing" | "config-error" | "error" — the raw
  // code shown under "Détail technique" is the kind itself for the first
  // two (they carry no separate `code` field), or the error's own code.
  const code = result.kind === "error" ? result.code : result.kind;
  return { kind: "verify-error", chosen, code };
};

export type OffsiteConstatScreenProps = {
  cwd: string;
  binPath: string;
  settings: OffsiteSettings;
  /** Mutated during both loading phases; consulted by the App-level Ctrl+C
   * handler so it doesn't race this screen's own local Ctrl+C handling. */
  runningRef: React.RefObject<boolean>;
  onContinue: (chosen: ChosenArchive) => void;
  onBack: () => void;
  /** Test seam. Defaults to the real pickArchiveToUpload. */
  pickArchiveToUpload?: PickArchiveToUploadFn;
  /** Test seam. Defaults to the real remoteStat. */
  remoteStat?: RemoteStatFn;
};

export const ConstatScreen = ({
  cwd,
  binPath,
  settings,
  runningRef,
  onContinue,
  onBack,
  pickArchiveToUpload = defaultPickArchiveToUpload,
  remoteStat = defaultRemoteStat,
}: OffsiteConstatScreenProps): React.JSX.Element => {
  const [state, setState] = useState<ConstatState>({ kind: "loading-local" });
  const [attempt, setAttempt] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    controllerRef.current = controller;
    runningRef.current = true;
    setState({ kind: "loading-local" });

    scanArchived(
      cwd,
      binPath,
      settings,
      pickArchiveToUpload,
      remoteStat,
      controller.signal,
      (intermediate) => {
        if (!cancelled) setState(intermediate);
      },
    )
      .then((result) => {
        if (cancelled || result === null) return;
        setState(result);
      })
      .finally(() => {
        if (!cancelled) runningRef.current = false;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      controller.abort();
      controllerRef.current = null;
      runningRef.current = false;
    };
    // `attempt` has no direct use inside the effect — it exists purely to
    // re-trigger this effect on a manual retry from the verify-error screen.
  }, [
    cwd,
    binPath,
    settings,
    pickArchiveToUpload,
    remoteStat,
    runningRef,
    attempt,
  ]);

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    const isLoading =
      state.kind === "loading-local" || state.kind === "loading-remote";
    if (key.ctrl && input === "c" && isLoading) {
      controllerRef.current?.abort();
      onBack();
      return;
    }
    if (!key.return) return;
    if (state.kind === "ready" || state.kind === "size-mismatch") {
      onContinue(state.chosen);
      return;
    }
    if (state.kind === "verify-error" && isTransientOffsiteError(state.code)) {
      setAttempt((a) => a + 1);
    }
  });

  const minimalFooter = [{ key: "Échap", label: "retour au menu" }];

  if (state.kind === "loading-local" || state.kind === "loading-remote") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
        <Box marginTop={1}>
          <Text dimColor>
            {state.kind === "loading-local"
              ? "Analyse du dossier…"
              : "Vérification en ligne…"}
          </Text>
        </Box>
      </Box>
    );
  }

  if (state.kind === "no-backup") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
        <Box marginTop={1}>
          <Text>Aucune sauvegarde à archiver dans ce dossier.</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>
            L'archivage en ligne part du fichier zip créé par « Sauvegarder les
            enregistrements découpés ». Lancez-le d'abord, puis revenez ici.
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>
            Si la sauvegarde est déjà faite, vous n'êtes sans doute pas dans le
            bon dossier. Dans le Terminal, tapez <Text color="cyan">pwd</Text>{" "}
            pour voir où vous êtes.
          </Text>
        </Box>
        <Footer hints={minimalFooter} />
      </Box>
    );
  }

  if (state.kind === "scan-error") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
        <Box marginTop={1}>
          <Text color="yellow">
            ⚠ Une erreur inattendue est survenue en lisant ce dossier.
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>
            Détail technique : <Text color="cyan">{state.rawCode}</Text>
          </Text>
          <Text dimColor>{"  (à transmettre si vous demandez de l'aide)"}</Text>
        </Box>
        <Footer hints={minimalFooter} />
      </Box>
    );
  }

  if (state.kind === "ready") {
    const { chosen, otherCount } = state;
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
        <Box marginTop={1}>
          <Text color="green">✓ </Text>
          <Text>Une sauvegarde est prête à être archivée en ligne.</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>{`  Fichier : ${chosen.name}`}</Text>
          <Text>{`  Taille  : ${formatBytes(chosen.size)}`}</Text>
        </Box>
        {otherCount > 0 ? (
          <Box marginTop={1} flexDirection="column">
            <Text>
              {`ℹ Ce dossier contient ${(otherCount + 1).toString()} fichiers de sauvegarde. chiro archive le`}
            </Text>
            <Text>
              {`  plus récent, celui du ${formatDayMonth(new Date(chosen.mtimeMs))}. Les autres ne sont pas concernés.`}
            </Text>
          </Box>
        ) : null}
        <Box marginTop={1} flexDirection="column">
          {/* Lines are split by hand, with their own indent, rather than left
              to Ink's wrapper: a continuation that starts at column 0 reads as
              a separate paragraph, and the block right above it is indented,
              so the inconsistency is visible on screen. */}
          <Text>
            {
              "ℹ Archiver, c'est garder une copie de ce fichier ailleurs qu'ici,"
            }
          </Text>
          <Text>{"  au cas où ce disque tombe en panne."}</Text>
          <Text>
            {"  Ce n'est pas le dépôt sur Vigie-Chiro : celui-ci reste à faire"}
          </Text>
          <Text>{"  depuis le site."}</Text>
        </Box>
        <Footer
          hints={[
            { key: "Entrée", label: "continuer" },
            { key: "Échap", label: "retour au menu" },
          ]}
        />
      </Box>
    );
  }

  if (state.kind === "already-online") {
    const { chosen, modTime } = state;
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
        <Box marginTop={1}>
          <Text color="green">✓ </Text>
          <Text>Cette sauvegarde est déjà archivée en ligne.</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>{`  Fichier : ${chosen.name}`}</Text>
          <Text>{`  Taille  : ${formatBytes(chosen.size)}`}</Text>
          <Text>{`  Archivée le ${formatDayMonthYear(new Date(modTime))}`}</Text>
        </Box>
        <Box marginTop={1}>
          <Text>Il n'y a rien à faire.</Text>
        </Box>
        <Footer hints={minimalFooter} />
      </Box>
    );
  }

  if (state.kind === "size-mismatch") {
    const { chosen, remoteBytes } = state;
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">
            ⚠ Un fichier du même nom est déjà en ligne, mais il n'a pas la même
            taille.
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>{`  Sur cet ordinateur : ${formatBytes(chosen.size)}`}</Text>
          <Text>{`  Déjà en ligne      : ${formatBytes(remoteBytes)}`}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>
            C'est le signe que la sauvegarde a été refaite depuis. Le fichier en
            ligne est une version plus ancienne.
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>
            Sur Entrée, chiro remplace celui qui est en ligne par celui de cet
            ordinateur. Votre fichier ici n'est pas touché.
          </Text>
        </Box>
        <Footer
          hints={[
            { key: "Entrée", label: "remplacer" },
            { key: "Échap", label: "retour au menu" },
          ]}
        />
      </Box>
    );
  }

  // state.kind === "verify-error"
  const transient = isTransientOffsiteError(state.code);

  if (transient) {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
        <Box marginTop={1}>
          <Text color="yellow">
            ⚠ Impossible de vérifier en ligne pour l'instant.
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text>Vérifiez votre connexion internet, puis réessayez.</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>
            Détail technique : <Text color="cyan">{state.code}</Text>
          </Text>
          <Text dimColor>{"  (à transmettre si vous demandez de l'aide)"}</Text>
        </Box>
        <Footer
          hints={[
            { key: "Entrée", label: "réessayer" },
            { key: "Échap", label: "retour au menu" },
          ]}
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
      <Text>{`📁 ${fitPath(cwd, 63)}`}</Text>
      <Box marginTop={1}>
        <Text color="yellow">
          ⚠ L'archivage en ligne n'est pas disponible pour l'instant.
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>
          {`Ce n'est pas lié à vos fichiers : ils sont intacts, et votre sauvegarde est toujours dans ${ARCHIVED_DIR_DISPLAY}.`}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>{mapKnownOffsiteErrorCode(state.code)}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>
          Détail technique : <Text color="cyan">{state.code}</Text>
        </Text>
        <Text dimColor>{"  (à transmettre si vous demandez de l'aide)"}</Text>
      </Box>
      <Footer hints={minimalFooter} />
    </Box>
  );
};
