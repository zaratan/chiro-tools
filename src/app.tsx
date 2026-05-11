import { useApp, useInput } from "ink";
import { useRef, useState } from "react";
import { MenuScreen } from "./screens/MenuScreen.js";
import { ConstatScreen } from "./screens/vigie-chiro/ConstatScreen.js";
import { FormScreen } from "./screens/vigie-chiro/FormScreen.js";
import type { ConstatCounts, FormInput } from "./types.js";

type Screen =
  | { kind: "menu" }
  | { kind: "vigie:constat" }
  | {
      kind: "vigie:form";
      constatCounts: ConstatCounts;
      wavFiles: string[];
    };
// In 2C, this union will gain "vigie:confirm" and "vigie:result" variants.

export type AppProps = {
  cwd: string;
};

export const App = ({ cwd }: AppProps): React.JSX.Element => {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>({ kind: "menu" });
  // Ref consulted by the global Ctrl+C handler. When true, Ctrl+C is ignored
  // at this level (ConfirmScreen will handle it locally during a running
  // rename batch, added in 2C). When false, Ctrl+C exits the program.
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

  // screen.kind === "vigie:form"
  return (
    <FormScreen
      onSubmit={(_input: FormInput) => {
        // Stub for 2C — will transition to vigie:confirm with input + wavFiles.
      }}
      onBack={() => {
        setScreen({ kind: "vigie:constat" });
      }}
    />
  );
};
