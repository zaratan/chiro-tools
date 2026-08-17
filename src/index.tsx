#!/usr/bin/env bun
import { render, Text } from "ink";
import { spawnSync } from "node:child_process";
import { App } from "./app.js";
import { runSelfTest } from "./lib/selftest/selfTest.js";
import { resolveInstallDirEnv } from "./lib/runtime/installDir.js";
import { isHomebrewInstall } from "./lib/runtime/isHomebrewInstall.js";
import {
  FALLBACK_INSTALL_SCRIPT_URL,
  INSTALL_SCRIPT_URL,
} from "./lib/update/constants.js";
import { detectRclone } from "./lib/offsite/detectRclone.js";
import { loadOffsiteSettings } from "./lib/offsite/settings.js";
import { resolveOffsiteAvailability } from "./lib/offsite/resolveOffsiteAvailability.js";
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

if (args.includes("--self-test")) {
  // Hidden — deliberately absent from HELP_TEXT. Exercised only by CI
  // (smoke-build, release) against the compiled binary, not by end users.
  //
  // The Ink render below proves yoga (inlined as base64 WASM) decodes and
  // renders inside the `bun --compile` binary: Ink 7 supports a
  // non-interactive, append-only render with no TTY attached, which is
  // exactly the environment a CI runner provides.
  const smokeInstance = render(<Text>chiro self-test</Text>);
  smokeInstance.unmount();
  await smokeInstance.waitUntilExit();

  const result = await runSelfTest();

  if (result.kind === "ok") {
    for (const check of result.checks) {
      process.stdout.write(`self-test: ${check}\n`);
    }
    process.exit(0);
  }

  process.stderr.write(`self-test: échec — ${result.check}\n`);
  process.stderr.write(`self-test: ${result.detail}\n`);
  process.exit(1);
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

const autoUpdateDisabled =
  isHomebrewInstall() || process.env.CHIRO_DISABLE_AUTOUPDATE === "1";

// Synchronous, before `render()` — never a `useEffect` probe. `MenuScreen`
// navigates by raw index into its item list; an entry appearing 100-300 ms
// after mount would shift every entry below it, and a keypress landing in
// that window could launch the wrong action (the exact race `detectSox`
// avoids the same way — see `docs/architecture.md` § offsite). `detectRclone`
// makes no network call; `loadOffsiteSettings` is a local file read. Neither
// can freeze the TUI before its first frame.
const rcloneAvailability = detectRclone();
const offsiteSettingsResult = await loadOffsiteSettings();
const offsiteAvailability = resolveOffsiteAvailability(
  rcloneAvailability,
  offsiteSettingsResult,
);

const instance = render(
  <App
    cwd={process.cwd()}
    autoUpdateDisabled={autoUpdateDisabled}
    offsiteAvailability={offsiteAvailability}
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
  // pipefail: without it the pipeline status is the inner bash's — a failed
  // curl feeds it zero bytes and the whole command exits 0, reported to the
  // user as a successful update that never happened.
  const installEnv = { ...process.env, ...resolveInstallDirEnv() };
  // install.sh reads CHIRO_VERSION as a version *pin*. A user who once
  // exported it in their shell would silently be "updated" back to that old
  // version forever — the in-app update always targets latest.
  delete installEnv.CHIRO_VERSION;
  const proc = spawnSync(
    "bash",
    ["-c", `set -o pipefail; curl -fL ${INSTALL_SCRIPT_URL} | bash`],
    { stdio: "inherit", env: installEnv },
  );
  // Propagate a meaningful exit code: real status if present, 130 on signal
  // (Ctrl+C convention), 1 otherwise so a silent crash is not reported as success.
  const exitCode = proc.status ?? (proc.signal !== null ? 130 : 1);

  if (exitCode !== 0) {
    // The pinned INSTALL_SCRIPT_URL can 404 (deleted tag, dev build with no
    // matching release) — a raw curl error is illegible for a non-technical
    // user, so point her at the unpinned fallback for a manual reinstall.
    process.stderr.write(
      "\nLa mise à jour automatique n'a pas pu aboutir.\n" +
        "Vous pouvez réessayer plus tard, ou installer manuellement en copiant" +
        " cette commande dans un terminal :\n\n" +
        `  curl -fL ${FALLBACK_INSTALL_SCRIPT_URL} | bash\n\n`,
    );
  }

  process.exit(exitCode);
}
