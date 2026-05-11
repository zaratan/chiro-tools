import { useApp, useInput } from "ink";
import { useRef, useState } from "react";
import { applyRenames as defaultApplyRenames } from "./lib/fs/applyRenames.js";
import { MenuScreen } from "./screens/MenuScreen.js";
import {
  ConfirmScreen,
  type ApplyRenamesFn,
} from "./screens/vigie-chiro/ConfirmScreen.js";
import { ConstatScreen } from "./screens/vigie-chiro/ConstatScreen.js";
import { FormScreen } from "./screens/vigie-chiro/FormScreen.js";
import { ResultScreen } from "./screens/vigie-chiro/ResultScreen.js";
import type { ConstatCounts, FormInput, RenameOutcome } from "./types.js";

type Screen =
  | { kind: "menu" }
  | { kind: "vigie:constat" }
  | {
      kind: "vigie:form";
      constatCounts: ConstatCounts;
      wavFiles: string[];
    }
  | {
      kind: "vigie:confirm";
      input: FormInput;
      wavFiles: string[];
    }
  | {
      kind: "vigie:result";
      input: FormInput;
      outcome: RenameOutcome;
    };

export type AppProps = {
  cwd: string;
  /** Override for tests. Defaults to the real implementation. */
  applyRenames?: ApplyRenamesFn;
};

export const App = ({
  cwd,
  applyRenames = defaultApplyRenames,
}: AppProps): React.JSX.Element => {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>({ kind: "menu" });
  // Ref consulted by the global Ctrl+C handler. When true, Ctrl+C is ignored
  // at this level (ConfirmScreen handles it locally during a running rename
  // batch). When false, Ctrl+C exits the program cleanly.
  const runningRef = useRef<boolean>(false);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (runningRef.current) return;
      exit();
      process.exit(130);
    }
  });

  if (screen.kind === "menu") {
    return (
      <MenuScreen
        onPickVigiePrefix={() => {
          setScreen({ kind: "vigie:constat" });
        }}
        onQuit={() => {
          exit();
        }}
      />
    );
  }

  if (screen.kind === "vigie:constat") {
    return (
      <ConstatScreen
        cwd={cwd}
        onContinue={(constatCounts, wavFiles) => {
          setScreen({ kind: "vigie:form", constatCounts, wavFiles });
        }}
        onBack={() => {
          setScreen({ kind: "menu" });
        }}
      />
    );
  }

  if (screen.kind === "vigie:form") {
    const { wavFiles } = screen;
    return (
      <FormScreen
        onSubmit={(input: FormInput) => {
          setScreen({ kind: "vigie:confirm", input, wavFiles });
        }}
        onBack={() => {
          setScreen({ kind: "vigie:constat" });
        }}
      />
    );
  }

  if (screen.kind === "vigie:confirm") {
    return (
      <ConfirmScreen
        cwd={cwd}
        input={screen.input}
        wavFiles={screen.wavFiles}
        runningRef={runningRef}
        applyRenames={applyRenames}
        onComplete={(outcome) => {
          setScreen({
            kind: "vigie:result",
            input: screen.input,
            outcome,
          });
        }}
        onBack={() => {
          setScreen({ kind: "vigie:constat" });
        }}
      />
    );
  }

  // screen.kind === "vigie:result"
  return (
    <ResultScreen
      input={screen.input}
      outcome={screen.outcome}
      onBackToMenu={() => {
        setScreen({ kind: "menu" });
      }}
    />
  );
};
