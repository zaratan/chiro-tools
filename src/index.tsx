#!/usr/bin/env bun
import { render } from "ink";
import { spawnSync } from "node:child_process";
import { App } from "./app.js";
import { INSTALL_SCRIPT_URL } from "./lib/update/constants.js";
import { CHIRO_VERSION } from "./version.js";

const args = process.argv.slice(2);

const HELP_TEXT = `chiro — outils Vigie-Chiro

  Lancez \`chiro\` sans argument dans un dossier contenant vos
  enregistrements .wav. Une interface interactive vous guide.

  Options :
    --version, -v   Affiche la version
    --help, -h      Affiche cette aide
`;

if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write(`chiro ${CHIRO_VERSION}\n`);
  process.exit(0);
}

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(HELP_TEXT);
  process.exit(0);
}

if (args.length > 0) {
  process.stderr.write(
    "chiro ne prend pas encore d'argument. Lancez simplement `chiro` dans un dossier d'enregistrements .wav.\n",
  );
  process.exit(0);
}

if (!process.stdout.isTTY) {
  process.stderr.write(
    "chiro doit être lancé dans un terminal interactif.\n(Pas de TTY détecté — la sortie a probablement été redirigée.)\n",
  );
  process.exit(1);
}

// Using an object so that TypeScript flow analysis does not narrow the flag
// to `false` permanently (a plain `let boolean` would be flagged as
// always-falsy by @typescript-eslint/no-unnecessary-condition).
const state = { installAfterExit: false };

const instance = render(
  <App
    cwd={process.cwd()}
    onRequestUpdate={() => {
      state.installAfterExit = true;
    }}
  />,
  { exitOnCtrlC: false },
);

await instance.waitUntilExit();

if (state.installAfterExit) {
  // Run install.sh post-Ink so stdout is not contested.
  // stdio inherited so the user sees curl progress and install.sh feedback directly.
  const proc = spawnSync(
    "bash",
    ["-c", `curl -fL ${INSTALL_SCRIPT_URL} | bash`],
    { stdio: "inherit" },
  );
  // Propagate a meaningful exit code: real status if present, 130 on signal
  // (Ctrl+C convention), 1 otherwise so a silent crash is not reported as success.
  process.exit(proc.status ?? (proc.signal !== null ? 130 : 1));
}
