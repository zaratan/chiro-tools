#!/usr/bin/env bun
import { render } from "ink";
import { App } from "./app.js";
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

render(<App cwd={process.cwd()} />, { exitOnCtrlC: false });
