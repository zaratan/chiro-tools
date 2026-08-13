import { Box, Text, useInput } from "ink";
import { Footer } from "../../components/Footer.js";
import {
  buildOutDir,
  PROCESSED_DIR_DISPLAY,
} from "../../lib/audio/batchPlan.js";
import {
  ARCHIVED_DIR_DISPLAY,
  buildArchivedDir,
  type ArchiveEntryStat,
} from "../../lib/archive/planArchive.js";
import { formatBytes } from "../../lib/format/bytes.js";
import { mapKnownArchiveErrorCode } from "./errorMessages.js";
import { RunningView } from "./RunningView.js";
import {
  useArchiveRun,
  type ArchiveRunOutcome,
  type CreateZipArchiveFn,
} from "./useArchiveRun.js";

export type { CreateZipArchiveFn };

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

export type ArchiveConfirmScreenProps = {
  cwd: string;
  entries: readonly ArchiveEntryStat[];
  totalBytes: number;
  /** Mutated during the run; consulted by the App-level Ctrl+C handler. */
  runningRef: React.RefObject<boolean>;
  /** Injected for tests. Defaults to the real implementation. */
  createZipArchive: CreateZipArchiveFn;
  onComplete: (outcome: ArchiveRunOutcome) => void;
  onBack: () => void;
};

export const ConfirmScreen = ({
  cwd,
  entries,
  totalBytes,
  runningRef,
  createZipArchive,
  onComplete,
  onBack,
}: ArchiveConfirmScreenProps): React.JSX.Element => {
  const processedDir = buildOutDir(cwd);
  const archivedDir = buildArchivedDir(cwd);

  const { state, startArchive, abort, registerRunningViewHandles } =
    useArchiveRun({
      cwd,
      processedDir,
      archivedDir,
      entries,
      totalBytes,
      runningRef,
      createZipArchive,
      onComplete,
    });

  useInput((input2, key) => {
    if (state.kind === "running") {
      if (key.ctrl && input2 === "c") {
        abort();
      }
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
        cwd={cwd}
        entries={entries}
        totalBytes={totalBytes}
        zipDisplayPath={`${ARCHIVED_DIR_DISPLAY}${state.fileName}`}
        onMount={registerRunningViewHandles}
      />
    );
  }

  if (state.kind === "run-error") {
    const knownMessage = mapKnownArchiveErrorCode(state.code);
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text>📁 {cwd}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text color="yellow">
            ⚠ Une erreur est survenue pendant la création du zip.
          </Text>
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
        </Box>
        <Footer hints={[{ key: "Échap", label: "revenir au début" }]} />
      </Box>
    );
  }

  // state.kind === "preview"
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
          <Text color="cyan">{state.fileName}</Text>
        </Text>
        <Text>{`Emplacement :    ${ARCHIVED_DIR_DISPLAY}`}</Text>
        <Text>
          {`Taille du zip :  au plus ${formatBytes(totalBytes)} — souvent moins, le zip compresse`}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          La date et l'heure de création sont dans le nom du fichier.
        </Text>
        {state.zipAlreadyExists ? (
          <Text dimColor>
            {`Un zip existe déjà dans ${ARCHIVED_DIR_DISPLAY} — celui-ci s'ajoutera à côté.`}
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
};
