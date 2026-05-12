import { Box, Text, useInput } from "ink";
import { Footer } from "../../components/Footer.js";
import type { ProcessError, ProcessOutcome } from "../../types.js";
import { mapProcessErrorCodeToMessage } from "./errorMessages.js";

const TRUNCATE_PER_GROUP = 5;

type Variant =
  | { kind: "interrupted"; outcome: ProcessOutcome }
  | { kind: "all-failed"; outcome: ProcessOutcome }
  | { kind: "success"; outcome: ProcessOutcome }
  | { kind: "partial-errors"; outcome: ProcessOutcome };

const sumChunks = (outcome: ProcessOutcome): number =>
  outcome.processed.reduce((acc, p) => acc + p.chunkCount, 0);

const classify = (outcome: ProcessOutcome): Variant => {
  if (outcome.interrupted) {
    return { kind: "interrupted", outcome };
  }
  if (
    outcome.processed.length === 0 &&
    (outcome.errored.length > 0 ||
      outcome.skippedTooLarge.length > 0 ||
      outcome.skippedAlreadyChunked.length > 0)
  ) {
    return { kind: "all-failed", outcome };
  }
  if (outcome.errored.length > 0) {
    return { kind: "partial-errors", outcome };
  }
  return { kind: "success", outcome };
};

type ErrorGroup = {
  message: string;
  files: readonly string[];
};

const groupErrors = (errored: readonly ProcessError[]): ErrorGroup[] => {
  const byMessage = new Map<string, string[]>();
  for (const err of errored) {
    const msg = mapProcessErrorCodeToMessage(err.reason);
    const list = byMessage.get(msg) ?? [];
    list.push(err.file);
    byMessage.set(msg, list);
  }
  return Array.from(byMessage.entries()).map(([message, files]) => ({
    message,
    files,
  }));
};

const renderSummary = (outcome: ProcessOutcome): React.JSX.Element => {
  const filesDone = outcome.processed.length;
  const chunksDone = sumChunks(outcome);
  return (
    <Box flexDirection="column">
      <Text>
        {`  ${filesDone.toString()} enregistrement${
          filesDone > 1 ? "s découpés" : " découpé"
        }`}
      </Text>
      <Text>
        {`  ${chunksDone.toString()} morceau${
          chunksDone > 1 ? "x créés" : " créé"
        } dans ./processed/`}
      </Text>
      {outcome.skippedTooLarge.length > 0 ? (
        <Text dimColor>
          {`  ${outcome.skippedTooLarge.length.toString()} fichier${
            outcome.skippedTooLarge.length > 1
              ? "s trop volumineux ignorés"
              : " trop volumineux ignoré"
          } (> 500 Mo)`}
        </Text>
      ) : null}
      {outcome.skippedAlreadyChunked.length > 0 ? (
        <Text dimColor>
          {`  ${outcome.skippedAlreadyChunked.length.toString()} fichier${
            outcome.skippedAlreadyChunked.length > 1 ? "s ignorés" : " ignoré"
          } (déjà au format morceau)`}
        </Text>
      ) : null}
    </Box>
  );
};

export type ProcessResultScreenProps = {
  outcome: ProcessOutcome;
  onBackToMenu: () => void;
};

export const ResultScreen = ({
  outcome,
  onBackToMenu,
}: ProcessResultScreenProps): React.JSX.Element => {
  const variant = classify(outcome);

  useInput((_input, key) => {
    if (key.return) onBackToMenu();
  });

  if (variant.kind === "success") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text color="green" bold>
          ✓ Terminé !
        </Text>
        <Box marginTop={1}>{renderSummary(outcome)}</Box>
        <Box marginTop={1}>
          <Text dimColor>
            Vos fichiers d'origine sont intacts dans ce dossier.
          </Text>
        </Box>
        <Footer hints={[{ key: "Entrée", label: "retour au menu" }]} />
      </Box>
    );
  }

  if (variant.kind === "interrupted") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text color="cyan">ℹ Découpage arrêté à votre demande</Text>
        <Box marginTop={1}>{renderSummary(outcome)}</Box>
        <Box marginTop={1}>
          <Text>
            Vous pouvez relancer chiro plus tard — il faudra d'abord renommer ou
            supprimer le dossier « processed » créé.
          </Text>
        </Box>
        <Text dimColor>
          Vos fichiers d'origine sont intacts dans ce dossier.
        </Text>
        <Footer hints={[{ key: "Entrée", label: "retour au menu" }]} />
      </Box>
    );
  }

  if (variant.kind === "all-failed") {
    const groups = groupErrors(outcome.errored);
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text color="yellow">⚠ Aucun enregistrement n'a pu être découpé</Text>
        {outcome.errored.length > 0 ? (
          <Box flexDirection="column" marginTop={1}>
            {groups.map((g) => (
              <Text key={g.message}>
                {`  • ${g.message} (${g.files.length.toString()} fichier${g.files.length > 1 ? "s" : ""})`}
              </Text>
            ))}
          </Box>
        ) : null}
        {outcome.skippedTooLarge.length > 0 ? (
          <Box marginTop={1}>
            <Text>
              {`  ${outcome.skippedTooLarge.length.toString()} fichier${
                outcome.skippedTooLarge.length > 1
                  ? "s trop volumineux"
                  : " trop volumineux"
              } (> 500 Mo) — découpez-les avec un autre outil`}
            </Text>
          </Box>
        ) : null}
        <Footer hints={[{ key: "Entrée", label: "retour au menu" }]} />
      </Box>
    );
  }

  // variant.kind === "partial-errors"
  const groups = groupErrors(outcome.errored);
  const totalErrored = outcome.errored.length;

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
      <Text color="yellow">
        {`⚠ Découpage terminé avec ${totalErrored.toString()} souci${
          totalErrored > 1 ? "s" : ""
        }`}
      </Text>
      <Box marginTop={1}>{renderSummary(outcome)}</Box>
      <Box marginTop={1}>
        <Text>
          {`  ${totalErrored.toString()} enregistrement${
            totalErrored > 1
              ? "s n'ont pas pu être découpés"
              : " n'a pas pu être découpé"
          } :`}
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {groups.map((group) => {
          const visibleFiles = group.files.slice(0, TRUNCATE_PER_GROUP);
          const truncatedCount = group.files.length - visibleFiles.length;
          return (
            <Box key={group.message} flexDirection="column" marginBottom={1}>
              <Text>
                {`    • ${group.message} (${group.files.length.toString()} fichier${
                  group.files.length > 1 ? "s" : ""
                })`}
              </Text>
              {visibleFiles.map((f) => (
                <Text key={f}>{`        ${f}`}</Text>
              ))}
              {truncatedCount > 0 ? (
                <Text dimColor>
                  {`        ... et ${truncatedCount.toString()} autre${
                    truncatedCount > 1 ? "s" : ""
                  }`}
                </Text>
              ) : null}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text>Les autres enregistrements ont bien été découpés.</Text>
      </Box>
      <Text dimColor>Vos fichiers d'origine sont intacts dans ce dossier.</Text>
      <Footer hints={[{ key: "Entrée", label: "retour au menu" }]} />
    </Box>
  );
};
