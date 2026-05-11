import { useApp, useInput } from "ink";
import { useRef } from "react";
import { MenuScreen } from "./screens/MenuScreen.js";

export type AppProps = {
  cwd: string;
};

export const App = ({ cwd: _cwd }: AppProps): React.JSX.Element => {
  const { exit } = useApp();
  // Consulted by the global Ctrl+C handler. When true, Ctrl+C is
  // ignored at this level (ConfirmScreen handles it locally during a
  // running rename batch). When false, Ctrl+C exits the program.
  // runningRef will be passed down to ConfirmScreen in 2C.
  // Prefixed with _ because it is intentionally unused in 2A (no ConfirmScreen yet).
  // It will be passed to ConfirmScreen in 2C to coordinate Ctrl+C handling.
  const _runningRef = useRef<boolean>(false);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      if (_runningRef.current) return;
      exit();
      process.exit(130);
    }
  });

  return (
    <MenuScreen
      onPickVigiePrefix={() => {
        // Stub for 2B (transition to ConstatScreen)
      }}
      onQuit={() => {
        exit();
      }}
    />
  );
};
