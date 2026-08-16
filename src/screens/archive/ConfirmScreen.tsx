import { Box, Text, useInput } from "ink";
import { Footer } from "../../components/Footer.js";
import { PROCESSED_DIR_DISPLAY } from "../../lib/audio/batchPlan.js";
import {
  ARCHIVED_DIR_DISPLAY,
  type ArchiveEntryStat,
} from "../../lib/archive/planArchive.js";
import { maxVolumeBytes } from "../../lib/archive/maxVolumeBytes.js";
import { UPLOAD_DIR_DISPLAY } from "../../lib/archive/planUpload.js";
import { formatBytes } from "../../format/bytes.js";
import {
  isTransientArchiveError,
  mapKnownArchiveErrorCode,
} from "./errorMessages.js";
import { RunningView } from "./RunningView.js";
import {
  useArchiveRun,
  type ArchiveFlowMode,
  type ArchiveRunOutcome,
  type ArchiveRunner,
  type BuildRunSessionEvent,
  type ResolveTargetName,
} from "./useArchiveRun.js";

export type { ArchiveFlowMode };

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

const DIR_LABEL: Record<ArchiveFlowMode, string> = {
  backup: "archived",
  package: "upload",
};

// « zips » is banned in a full sentence addressed to the user (docs/ux.md) —
// the only assumed exceptions are the menu label and a footer hint, where the
// word stands alone under a width constraint. This is the one screen she
// reads carefully, after losing twelve minutes; jargon belongs here least.
const RUN_ERROR_TITLE: Record<ArchiveFlowMode, string> = {
  backup: "Une erreur est survenue pendant la création du zip.",
  package: "Une erreur est survenue pendant la préparation des fichiers zip.",
};

const RETRY_RESTART_HINT: Record<ArchiveFlowMode, string> = {
  backup: "(la création du zip reprend depuis le début)",
  package: "(la création des fichiers zip reprend depuis le début)",
};

export type ArchiveConfirmScreenProps = {
  /** Wording-only branch — behavior is fully injected below, never keyed on
   * this (phase-9 plan, D7). */
  mode: ArchiveFlowMode;
  cwd: string;
  entries: readonly ArchiveEntryStat[];
  totalBytes: number;
  /** Mutated during the run; consulted by the App-level Ctrl+C handler. */
  runningRef: React.RefObject<boolean>;
  /** Injected — built by `createBackupBehavior`/`createPackageBehavior`. */
  runner: ArchiveRunner;
  resolveTargetName: ResolveTargetName;
  buildSessionEvent: BuildRunSessionEvent;
  onComplete: (outcome: ArchiveRunOutcome) => void;
  onBack: () => void;
};

export const ConfirmScreen = ({
  mode,
  cwd,
  entries,
  totalBytes,
  runningRef,
  runner,
  resolveTargetName,
  buildSessionEvent,
  onComplete,
  onBack,
}: ArchiveConfirmScreenProps): React.JSX.Element => {
  const { state, startArchive, abort, retry, registerRunningViewHandles } =
    useArchiveRun({
      cwd,
      entries,
      totalBytes,
      runningRef,
      runner,
      resolveTargetName,
      buildSessionEvent,
      onComplete,
    });

  useInput((input2, key) => {
    if (state.kind === "running") {
      if (key.ctrl && input2 === "c") {
        abort();
      }
      return;
    }
    if (state.kind === "cleaning") {
      return;
    }
    if (state.kind === "loading") {
      if (key.escape) onBack();
      return;
    }
    if (key.escape) {
      onBack();
      return;
    }
    if (key.return) {
      if (state.kind === "run-error") {
        if (isTransientArchiveError(state.code)) retry();
        return;
      }
      void startArchive();
    }
  });

  if (state.kind === "loading") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text dimColor>Préparation…</Text>
      </Box>
    );
  }

  if (state.kind === "running") {
    return (
      <RunningView
        mode={mode}
        cwd={cwd}
        entries={entries}
        totalBytes={totalBytes}
        onMount={registerRunningViewHandles}
      />
    );
  }

  if (state.kind === "cleaning") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text>Annulation en cours…</Text>
        <Box marginTop={1}>
          <Text dimColor>Nettoyage des fichiers temporaires, un instant.</Text>
        </Box>
        <Footer hints={[]} />
      </Box>
    );
  }

  if (state.kind === "run-error") {
    const dirLabel = DIR_LABEL[mode];
    const knownMessage = mapKnownArchiveErrorCode(state.code, dirLabel);
    const transient = isTransientArchiveError(state.code);
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text>📁 {cwd}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">⚠ {RUN_ERROR_TITLE[mode]}</Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>
            Aucun fichier zip n'a été créé — vos enregistrements sont intacts.
          </Text>
        </Box>
        {knownMessage !== null ? (
          <Box marginTop={1} flexDirection="column">
            <Text>{asSentence(knownMessage)}</Text>
          </Box>
        ) : null}
        <Box marginTop={1} flexDirection="column">
          <Text>
            Détail technique : <Text color="cyan">{state.code}</Text>
          </Text>
          <Text dimColor>{"  (à transmettre si vous demandez de l'aide)"}</Text>
          {transient ? <Text dimColor>{RETRY_RESTART_HINT[mode]}</Text> : null}
        </Box>
        <Footer
          hints={
            transient
              ? [
                  { key: "Entrée", label: "réessayer" },
                  { key: "Échap", label: "revenir au début" },
                ]
              : [{ key: "Échap", label: "revenir au début" }]
          }
        />
      </Box>
    );
  }

  // state.kind === "preview"
  if (mode === "backup") {
    const archivedDir = ARCHIVED_DIR_DISPLAY;
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text>📁 {cwd}</Text>
        <Box marginTop={1}>
          <Text>
            {`On va rassembler ${entries.length.toString()} enregistrement${
              entries.length > 1 ? "s" : ""
            } dans un fichier zip.`}
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text>
            {`Nom du fichier : `}
            <Text color="cyan">{state.name}</Text>
          </Text>
          <Text>{`Emplacement :    ${archivedDir}`}</Text>
          <Text>
            {`Taille du zip :  au plus ${formatBytes(totalBytes)} — souvent moins, le zip compresse`}
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>La date de création est dans le nom du fichier.</Text>
          {state.alreadyExists ? (
            <Text dimColor>
              {`Un zip existe déjà dans ${archivedDir} — celui-ci s'ajoutera à côté.`}
            </Text>
          ) : null}
          <Text dimColor>
            {`Vos enregistrements restent dans ${PROCESSED_DIR_DISPLAY}.`}
          </Text>
          <Text dimColor>Rien n'est déplacé ni supprimé.</Text>
        </Box>
        <Footer
          hints={[
            { key: "Entrée", label: "créer le zip" },
            { key: "Échap", label: "revenir au début" },
          ]}
        />
      </Box>
    );
  }

  // mode === "package"
  // The zip count is unknowable before the run (compression only happens
  // during it — D1), so this is a display-only estimate: uncompressed
  // source size fits in one volume ⇒ almost certainly one volume. A wrong
  // guess here only costs a slightly-off sentence, never a wrong result —
  // the Result screen always reflects what actually happened.
  const estimatedSingleVolume = totalBytes <= maxVolumeBytes();
  return (
    <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
      <Text>📁 {cwd}</Text>
      <Box marginTop={1}>
        <Text>
          {estimatedSingleVolume
            ? `On va rassembler ${entries.length.toString()} enregistrement${
                entries.length > 1 ? "s" : ""
              } dans un fichier zip.`
            : `On va rassembler ${entries.length.toString()} enregistrements dans plusieurs fichiers zip.`}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text>
          {`Emplacement :      `}
          <Text color="cyan">{`${UPLOAD_DIR_DISPLAY}${state.name}/`}</Text>
        </Text>
        <Text>
          {estimatedSingleVolume
            ? // The volume cap is meaningless when a single file is expected:
              // announcing "au plus 3,5 Go" for a 1,4 Go source contradicts
              // the total she just read on the previous screen, and the backup
              // flow's own wording for the very same folder. Bound by the
              // source, like backup does.
              `Taille :           au plus ${formatBytes(totalBytes)} — souvent moins, le zip compresse`
            : `Taille de chacun : au plus ${formatBytes(maxVolumeBytes())}`}
        </Text>
      </Box>
      {!estimatedSingleVolume ? (
        <Box marginTop={1} flexDirection="column">
          <Text>
            Vigie-Chiro n'accepte pas les fichiers trop volumineux : vos
            enregistrements seront répartis en plusieurs fichiers zip, à déposer
            un par un sur le site.
          </Text>
        </Box>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          {estimatedSingleVolume
            ? "Le fichier zip n'apparaîtra qu'à la fin."
            : "Les fichiers zip n'apparaîtront qu'à la fin, tous en même temps."}
        </Text>
        {state.alreadyExists ? (
          <Text dimColor>
            {`Un dossier de dépôt existe déjà dans ${UPLOAD_DIR_DISPLAY} — celui-ci s'ajoutera à côté.`}
          </Text>
        ) : null}
        <Text dimColor>
          {`Vos enregistrements restent dans ${PROCESSED_DIR_DISPLAY}.`}
        </Text>
        <Text dimColor>Rien n'est déplacé ni supprimé.</Text>
      </Box>
      <Footer
        hints={[
          {
            key: "Entrée",
            label: estimatedSingleVolume ? "créer le zip" : "créer les zips",
          },
          { key: "Échap", label: "revenir au début" },
        ]}
      />
    </Box>
  );
};
