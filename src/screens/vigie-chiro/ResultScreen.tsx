import { Box, Text, useInput } from "ink";
import { Footer } from "../../components/Footer.js";
import { buildPrefix } from "../../lib/vigie-chiro/prefix.js";
import type { FormInput, RenameError, RenameOutcome } from "../../types.js";
import { mapErrorCodeToMessage } from "./errorMessages.js";

type Variant =
  | { kind: "interrupted" }
  | { kind: "nothing-to-do"; alreadyCount: number }
  | { kind: "success"; renamedCount: number; alreadyCount: number }
  | {
      kind: "partial-errors";
      renamedCount: number;
      errored: readonly RenameError[];
    };

const classify = (outcome: RenameOutcome): Variant => {
  if (outcome.interrupted) {
    return { kind: "interrupted" };
  }
  if (outcome.errored.length > 0) {
    return {
      kind: "partial-errors",
      renamedCount: outcome.renamed.length,
      errored: outcome.errored,
    };
  }
  if (
    outcome.renamed.length === 0 &&
    outcome.skippedAlreadyPrefixed.length > 0
  ) {
    return {
      kind: "nothing-to-do",
      alreadyCount: outcome.skippedAlreadyPrefixed.length,
    };
  }
  return {
    kind: "success",
    renamedCount: outcome.renamed.length,
    alreadyCount: outcome.skippedAlreadyPrefixed.length,
  };
};

const TRUNCATE_PER_GROUP = 5;

type ErrorGroup = {
  message: string;
  files: readonly string[];
};

const groupErrors = (errored: readonly RenameError[]): ErrorGroup[] => {
  const byMessage = new Map<string, string[]>();
  for (const err of errored) {
    const msg = mapErrorCodeToMessage(err.reason);
    const list = byMessage.get(msg) ?? [];
    list.push(err.file);
    byMessage.set(msg, list);
  }
  return Array.from(byMessage.entries()).map(([message, files]) => ({
    message,
    files,
  }));
};

export type ResultScreenProps = {
  input: FormInput;
  outcome: RenameOutcome;
  onBackToMenu: () => void;
};

export const ResultScreen = ({
  input,
  outcome,
  onBackToMenu,
}: ResultScreenProps): React.JSX.Element => {
  const variant = classify(outcome);

  useInput((_input, key) => {
    if (key.return) onBackToMenu();
  });

  if (variant.kind === "success") {
    const prefix = buildPrefix(input);
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text color="green" bold>
          ✓ Terminé !
        </Text>
        <Box marginTop={1}>
          <Text>
            {`  ${variant.renamedCount.toString()} fichier${variant.renamedCount > 1 ? "s" : ""} renommé${variant.renamedCount > 1 ? "s" : ""} avec le préfixe`}
          </Text>
        </Box>
        <Text>
          {`      `}
          <Text color="cyan">{prefix}</Text>
        </Text>
        {variant.alreadyCount > 0 ? (
          <Text>
            {`  ${variant.alreadyCount.toString()} fichier${variant.alreadyCount > 1 ? "s laissés tels quels" : " laissé tel quel"} (déjà au bon format)`}
          </Text>
        ) : null}
        <Box marginTop={1}>
          <Text>Vous pouvez maintenant les téléverser sur Vigie-Chiro.</Text>
        </Box>
        <Footer hints={[{ key: "Entrée", label: "retour au menu" }]} />
      </Box>
    );
  }

  if (variant.kind === "nothing-to-do") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text color="green" bold>
          ✓ Rien à faire — tout est déjà au bon format.
        </Text>
        <Box marginTop={1}>
          <Text>
            {`  ${variant.alreadyCount.toString()} fichier${variant.alreadyCount > 1 ? "s déjà nommés correctement" : " déjà nommé correctement"}.`}
          </Text>
        </Box>
        <Footer hints={[{ key: "Entrée", label: "retour au menu" }]} />
      </Box>
    );
  }

  if (variant.kind === "interrupted") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text color="cyan">ℹ Renommage arrêté à votre demande</Text>
        <Box flexDirection="column" marginTop={1}>
          <Text>
            {`  ${outcome.renamed.length.toString()} fichier${outcome.renamed.length > 1 ? "s déjà renommés (conservés en sécurité)" : " déjà renommé (conservé en sécurité)"}`}
          </Text>
          <Text>
            {`  Il restait ${(outcome.skippedCollision.length + outcome.errored.length).toString()} fichier${outcome.skippedCollision.length + outcome.errored.length > 1 ? "s" : ""} à traiter.`}
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text>
            Vous pouvez relancer chiro à tout moment — les fichiers déjà
            renommés seront reconnus et ne seront pas touchés deux fois.
          </Text>
        </Box>
        <Footer hints={[{ key: "Entrée", label: "retour au menu" }]} />
      </Box>
    );
  }

  // variant.kind === "partial-errors"
  const groups = groupErrors(variant.errored);
  const totalErrored = variant.errored.length;

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
      <Text color="yellow">
        ⚠ Renommage terminé avec {totalErrored.toString()} souci
        {totalErrored > 1 ? "s" : ""}
      </Text>
      <Box marginTop={1}>
        <Text>
          {`  ${variant.renamedCount.toString()} fichier${variant.renamedCount > 1 ? "s renommés" : " renommé"} ✓`}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text>
          {`  ${totalErrored.toString()} fichier${totalErrored > 1 ? "s n'ont pas pu être renommés" : " n'a pas pu être renommé"} :`}
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {groups.map((group) => {
          const visibleFiles = group.files.slice(0, TRUNCATE_PER_GROUP);
          const truncatedCount = group.files.length - visibleFiles.length;
          return (
            <Box key={group.message} flexDirection="column" marginBottom={1}>
              <Text>
                {"    • "}
                {group.message} ({group.files.length.toString()} fichier
                {group.files.length > 1 ? "s" : ""})
              </Text>
              {visibleFiles.map((f) => (
                <Text key={f}>{`        ${f}`}</Text>
              ))}
              {truncatedCount > 0 ? (
                <Text dimColor>
                  {`        ... et ${truncatedCount.toString()} autre${truncatedCount > 1 ? "s" : ""}`}
                </Text>
              ) : null}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text>Les autres fichiers ont bien été renommés.</Text>
      </Box>
      <Footer hints={[{ key: "Entrée", label: "retour au menu" }]} />
    </Box>
  );
};
