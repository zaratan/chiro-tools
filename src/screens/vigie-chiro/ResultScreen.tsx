import { Box, Text, useInput } from "ink";
import { Footer } from "../../components/Footer.js";
import { classifyRenameOutcome } from "../../lib/vigie-chiro/classifyRenameOutcome.js";
import { buildPrefix } from "../../lib/vigie-chiro/prefix.js";
import type { FormInput, RenameError, RenameOutcome } from "../../types.js";
import { mapErrorCodeToMessage } from "./errorMessages.js";

// Three, not five: on an 80×24 Terminal two groups of five scroll the title
// and the summary off the top, leaving her a wall of filenames with no idea
// what happened. The names only serve to be passed on.
const TRUNCATE_PER_GROUP = 3;

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

const TruncatedNames = ({
  names,
  indent,
}: {
  names: readonly string[];
  indent: string;
}): React.JSX.Element => {
  const visible = names.slice(0, TRUNCATE_PER_GROUP);
  const truncatedCount = names.length - visible.length;
  return (
    <>
      {visible.map((name) => (
        <Text key={name}>{`${indent}${name}`}</Text>
      ))}
      {truncatedCount > 0 ? (
        <Text dimColor>
          {`${indent}... et ${truncatedCount.toString()} autre${truncatedCount > 1 ? "s" : ""}`}
        </Text>
      ) : null}
    </>
  );
};

const ErrorsBlock = ({
  errored,
}: {
  errored: readonly RenameError[];
}): React.JSX.Element => (
  <>
    <Box marginTop={1}>
      <Text>
        {`  ${errored.length.toString()} fichier${errored.length > 1 ? "s n'ont pas pu être renommés" : " n'a pas pu être renommé"} :`}
      </Text>
    </Box>
    <Box flexDirection="column" marginTop={1}>
      {groupErrors(errored).map((group, index) => (
        <Box
          key={group.message}
          flexDirection="column"
          marginTop={index > 0 ? 1 : 0}
        >
          <Text>
            {"    • "}
            {group.message} ({group.files.length.toString()} fichier
            {group.files.length > 1 ? "s" : ""})
          </Text>
          <TruncatedNames names={group.files} indent="        " />
        </Box>
      ))}
    </Box>
  </>
);

const CollisionsBlock = ({
  collisions,
}: {
  collisions: readonly string[];
}): React.JSX.Element | null => {
  if (collisions.length === 0) return null;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow">
        {collisions.length > 1
          ? `⚠ ${collisions.length.toString()} fichiers n'ont pas été renommés`
          : "⚠ 1 fichier n'a pas été renommé"}
      </Text>
      <Text color="yellow">{"  (un fichier porte déjà le nom cible) :"}</Text>
      <TruncatedNames names={collisions} indent="    " />
    </Box>
  );
};

const NextStep = ({
  collisionCount,
  collisionsHaveWhitespace,
}: {
  collisionCount: number;
  collisionsHaveWhitespace: boolean;
}): React.JSX.Element => {
  if (collisionsHaveWhitespace) {
    return collisionCount > 1 ? (
      <Box flexDirection="column" marginTop={1}>
        <Text>{"Retirez ces fichiers du dossier avant de découper :"}</Text>
        <Text>
          {"leur nom contient un espace : le découpage ne démarrerait pas."}
        </Text>
      </Box>
    ) : (
      <Box flexDirection="column" marginTop={1}>
        <Text>{"Retirez ce fichier du dossier avant de découper :"}</Text>
        <Text>
          {"son nom contient un espace : le découpage ne démarrerait pas."}
        </Text>
      </Box>
    );
  }
  if (collisionCount > 1) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text>{"Vérifiez ces fichiers avant de découper :"}</Text>
        <Text>{"tels quels, ils seraient découpés avec les autres."}</Text>
      </Box>
    );
  }
  if (collisionCount === 1) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text>{"Vérifiez ce fichier avant de découper :"}</Text>
        <Text>{"tel quel, il serait découpé avec les autres."}</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>
        {"Vous pouvez maintenant les découper, puis créer les fichiers"}
      </Text>
      <Text>{"zip à déposer sur Vigie-Chiro."}</Text>
    </Box>
  );
};

const whitespaceFixedLine = (count: number): string =>
  count > 1
    ? `  ${count.toString()} fichiers déjà préfixés : espaces remplacés par « _ »`
    : "  1 fichier déjà préfixé : espaces remplacés par « _ »";

const leftAsIsLine = (alreadyCount: number): string =>
  `  ${alreadyCount.toString()} fichier${alreadyCount > 1 ? "s laissés tels quels" : " laissé tel quel"} (déjà au bon format)`;

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
  const variant = classifyRenameOutcome(outcome);

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
        <Box flexDirection="column" marginTop={1}>
          {variant.renamedCount > 0 ? (
            <>
              <Text>
                {`  ${variant.renamedCount.toString()} fichier${variant.renamedCount > 1 ? "s" : ""} renommé${variant.renamedCount > 1 ? "s" : ""} avec le préfixe`}
              </Text>
              <Text>
                {`      `}
                <Text color="cyan">{prefix}</Text>
              </Text>
            </>
          ) : null}
          {variant.whitespaceFixedCount > 0 ? (
            <Text>{whitespaceFixedLine(variant.whitespaceFixedCount)}</Text>
          ) : null}
          {variant.alreadyCount > 0 ? (
            <Text>{leftAsIsLine(variant.alreadyCount)}</Text>
          ) : null}
        </Box>
        <CollisionsBlock collisions={variant.collisions} />
        <NextStep
          collisionCount={variant.collisions.length}
          collisionsHaveWhitespace={variant.collisionsHaveWhitespace}
        />
        <Footer hints={[{ key: "Entrée", label: "retour au menu" }]} />
      </Box>
    );
  }

  if (variant.kind === "nothing-renamed") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text color="yellow">⚠ Aucun fichier n'a été renommé.</Text>
        {variant.alreadyCount > 0 ? (
          <Box marginTop={1}>
            <Text>{leftAsIsLine(variant.alreadyCount)}</Text>
          </Box>
        ) : null}
        <CollisionsBlock collisions={variant.collisions} />
        <NextStep
          collisionCount={variant.collisions.length}
          collisionsHaveWhitespace={variant.collisionsHaveWhitespace}
        />
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

  const changedCount = variant.renamedCount + variant.whitespaceFixedCount;

  if (variant.kind === "interrupted") {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
        <Text color="cyan">ℹ Renommage arrêté à votre demande</Text>
        <Box flexDirection="column" marginTop={1}>
          <Text>
            {`  ${changedCount.toString()} fichier${changedCount > 1 ? "s déjà renommés (conservés en sécurité)" : " déjà renommé (conservé en sécurité)"}`}
          </Text>
        </Box>
        {variant.errored.length > 0 ? (
          <ErrorsBlock errored={variant.errored} />
        ) : null}
        <CollisionsBlock collisions={variant.collisions} />
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

  const totalErrored = variant.errored.length;

  return (
    <Box flexDirection="column" padding={1} borderStyle="round" width={70}>
      <Text color="yellow">
        ⚠ Renommage terminé avec {totalErrored.toString()} souci
        {totalErrored > 1 ? "s" : ""}
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {changedCount === 0 ? <Text>{"  Aucun fichier renommé"}</Text> : null}
        {variant.renamedCount > 0 ? (
          <Text>
            {`  ${variant.renamedCount.toString()} fichier${variant.renamedCount > 1 ? "s renommés" : " renommé"} ✓`}
          </Text>
        ) : null}
        {variant.whitespaceFixedCount > 0 ? (
          <Text>{whitespaceFixedLine(variant.whitespaceFixedCount)}</Text>
        ) : null}
      </Box>
      <ErrorsBlock errored={variant.errored} />
      <CollisionsBlock collisions={variant.collisions} />
      {changedCount > 0 ? (
        <Box marginTop={1}>
          <Text>Les autres fichiers ont bien été renommés.</Text>
        </Box>
      ) : null}
      <Footer hints={[{ key: "Entrée", label: "retour au menu" }]} />
    </Box>
  );
};
