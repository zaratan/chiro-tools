# Architecture technique

## Stack

| Domaine            | Choix                                                                             | Notes                                                                                                                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package manager    | **pnpm** (≥ 10)                                                                   | Aligné sur les autres projets de l'auteur (cf. `~/Projects/arkham-proba`).                                                                                                                                                                              |
| Runtime dev + exec | **Bun** (dernière stable)                                                         | Bun lance le TS directement, sert de bundler/compileur pour le binaire.                                                                                                                                                                                 |
| Langage            | **TypeScript strict**                                                             | `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `skipLibCheck: true`.                                                                                                                                               |
| UI CLI             | **Ink 6** + **React 19**                                                          | TUI déclarative.                                                                                                                                                                                                                                        |
| Champs de saisie   | **`ink-text-input`** (champs texte) + saisie maison `managed` (champs numériques) | Wrappé dans un FormScreen maison. Les champs numériques (Année, Passage) sont rendus en `<Text>` brut pour éviter le conflit `←`/`→` avec le curseur d'`ink-text-input` ; FormScreen gère lui-même les chiffres, Backspace et l'ajustement par flèches. |
| Validation         | **Fonctions pures TS + regex** (pas de zod)                                       | 4 validators, 1 par champ.                                                                                                                                                                                                                              |
| Tests              | **vitest** + **`ink-testing-library`**                                            | vitest pour `src/lib/`, ink-testing-library en best-effort sur le parcours nominal.                                                                                                                                                                     |
| Build dev          | **Bun** (`bun src/index.tsx`)                                                     | Pas de tsx, pas de tsup au MVP — Bun couvre tout.                                                                                                                                                                                                       |
| Build → binaire    | **`bun build --compile`**                                                         | Targets `bun-darwin-arm64` ET `bun-linux-x64`.                                                                                                                                                                                                          |
| Lint               | **eslint** (config copiée de `~/Projects/arkham-proba`)                           | Adaptée mono-package.                                                                                                                                                                                                                                   |
| Formatage          | **prettier**                                                                      | Idem.                                                                                                                                                                                                                                                   |
| Hooks git          | **husky** + **lint-staged**                                                       | Idem.                                                                                                                                                                                                                                                   |
| Versioning         | **SemVer** dans `package.json`                                                    | Lu par `chiro --version` (compilé dans le binaire).                                                                                                                                                                                                     |

### Hors stack — choix conscients

- **Pas de zod** : 4 fonctions de validation triviales suffisent et permettent des messages d'erreur français custom plus lisibles que les `ZodError`.
- **Pas de tsup** : Bun bundle directement, on évite une dépendance.
- **Pas de commander/yargs** : le seul "argument" est `--version`/`--help`, géré en 5 lignes.
- **Pas de Sentry/télémétrie** : logging local JSONL suffit.
- **Pas de parseur RIFF maison** : on utilise `wavefile@^11.0.0` (MIT, pure-JS, zero dép runtime, ~30 KB). Cf. ADR ci-dessous.

### ADR — choix de `wavefile` pour la lib audio (Phase 5)

**Contexte** : la feature « Découper les enregistrements » a besoin de lire des WAV PCM 16/24-bit (mono ou stéréo), de slicer leurs samples par chunks de N secondes, et de réécrire des WAV avec un nouveau sample rate (pour l'expansion temporelle ×10). Le contenu PCM doit être bit-exact en entrée et en sortie (lossless).

**Options considérées** :

| Option                     | Pour                                                                               | Contre                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **`wavefile@11` (choisi)** | MIT, pure-JS, zero dép runtime, ~30 KB, gère WAVE_FORMAT_EXTENSIBLE + LIST chunks. | API typée laxiste (`fmt: object` non discriminé), drop des chunks `LIST` au re-encode (acceptable — Kaleidoscope idem). |
| Parseur RIFF maison        | Zero dép ajoutée, ownership total.                                                 | ~150 lignes + tests à maintenir, bugs subtils sur les variantes (EXTENSIBLE, RF64, `fact` chunk).                       |
| `ffmpeg` sidecar binaire   | Le plus capable.                                                                   | Casse le contrat « binaire autonome » de `bun --compile`. Installation manuelle pour l'utilisatrice — DEAL-BREAKER.     |
| `node-wav`, `wav-decoder`  | Plus simples.                                                                      | Couverture incomplète (24-bit, EXTENSIBLE manquants pour certains détecteurs).                                          |

**Conclusion** : `wavefile` répond exactement au besoin (modification d'en-tête + slice de samples), s'embarque proprement dans `bun --compile` (validé par le spike A.0 : 27 modules bundled, 0 warning), et son comportement de drop des chunks `LIST` au re-encode est aligné avec celui de Kaleidoscope — référence canonique du protocole Vigie-Chiro.

### Référence canonique — Kaleidoscope

Le protocole Vigie-Chiro Point Fixe (documenté dans `test-data/Tutoriel Vigie Chiro - Perso.pdf`, page 7) prescrit l'usage de Kaleidoscope pour deux paramètres :

| Paramètre Kaleidoscope       | Teensy / Passive Recorder | AudioMoth |
| ---------------------------- | ------------------------- | --------- |
| Time expansion factor INPUT  | 10                        | 1         |
| Time expansion factor OUTPUT | 10                        | 10        |
| Split to max duration (s)    | 5                         | 5         |

Conséquence : Teensy enregistre **déjà** en TE×10 au record-time (38 400 Hz « audible » représentant un réel 384 000 Hz) — on ne touche pas au sample rate. AudioMoth enregistre full-spectrum à 250 000 Hz — on réécrit `fmt.sampleRate ← 25 000` (lossless, header-only). Dans les deux cas, on découpe en chunks de 5 s mesurés sur la **timeline de sortie**.

## Structure du repo

```
chiro-tools/
├── .github/
│   └── workflows/
│       └── release.yml          # Phase 4 : build + sign + notarize + GH Release
├── .husky/
│   └── pre-commit               # lint-staged
├── docs/                        # CE DOSSIER — spec figée
├── scripts/
│   └── install.sh               # Téléchargement du bon binaire depuis GH Releases
├── src/
│   ├── index.tsx                # entry point — boot (TTY check, --version/--help) puis render <App />, post-Ink spawn install.sh si drapeau update
│   ├── app.tsx                  # routeur d'écrans (state machine) + auto-check boot via checkForUpdate
│   ├── version.ts               # CHIRO_VERSION lu depuis package.json (Bun inline à la compile)
│   ├── screens/
│   │   ├── MenuScreen.tsx
│   │   ├── UpdateScreen.tsx       # 4 états : checking / available / up-to-date / error
│   │   ├── updateErrorMessages.ts # mapping FR pour les 6 codes d'erreur Update
│   │   ├── vigie-chiro/           # flow "Préfixer" — 4 écrans
│   │   │   ├── ConstatScreen.tsx
│   │   │   ├── FormScreen.tsx     # focusedIndex + 4 <TextField> (numeric en mode managed)
│   │   │   ├── ConfirmScreen.tsx
│   │   │   ├── ResultScreen.tsx
│   │   │   └── errorMessages.ts   # mapping FR pour codes d'erreur rename
│   │   └── vigie-process/         # flow "Découper" — 4 écrans (Phase 5)
│   │       ├── ConstatScreen.tsx  # scan + perms + processed/ existant + statfs
│   │       ├── FormScreen.tsx     # sélecteur Teensy/Autre inline (pas de RadioSelect)
│   │       ├── ConfirmScreen.tsx  # preview durée + execution + logSession v2
│   │       ├── ResultScreen.tsx   # 4 variantes : success / interrupted / all-failed / partial
│   │       └── errorMessages.ts   # mapping FR pour codes d'erreur process
│   ├── components/
│   │   ├── TextField.tsx          # label + ink-text-input (ou Text en mode managed) + aide/erreur
│   │   └── Footer.tsx             # footer de raccourcis stylé
│   ├── lib/
│   │   ├── vigie-chiro/
│   │   │   ├── prefix.ts          # buildPrefix({carre,annee,passage,point}) → "Car..."
│   │   │   ├── prefix.test.ts
│   │   │   ├── isAlreadyPrefixed.ts
│   │   │   ├── isAlreadyPrefixed.test.ts
│   │   │   └── validation.ts      # validators purs par champ
│   │   ├── fs/
│   │   │   ├── scanWavFiles.ts    # lit cwd, filtre .wav, ignore dotfiles/dirs/symlinks
│   │   │   ├── scanWavFiles.test.ts
│   │   │   ├── safeFsOps.ts       # renameWithFallback (EXDEV) + writeFileAtomic (.tmp + rename)
│   │   │   ├── safeFsOps.test.ts
│   │   │   ├── planRenames.ts     # produit la liste {from, to, skipReason?}
│   │   │   ├── planRenames.test.ts
│   │   │   ├── applyRenames.ts    # consume renameWithFallback, séquentiel, gestion SIGINT
│   │   │   └── applyRenames.test.ts
│   │   ├── audio/                 # lib audio Phase 5 — split + TE×10 lossless
│   │   │   ├── splitWavFile.ts    # Generator<chunk|abort|error> ; pas d'I/O
│   │   │   ├── processWavFiles.ts # orchestrateur I/O — fstat cap 500 MB, filtre _NNN.wav$, pre-clean .tmp
│   │   │   └── __tests__/
│   │   │       ├── fixtures.ts                       # makeRampWav, makeSineWav, readSamplesPerChannel
│   │   │       ├── splitWavFile.test.ts
│   │   │       ├── processWavFiles.test.ts
│   │   │       └── processWavFiles.integration.test.ts  # SUR FICHIERS RÉELS test-data/ via git-lfs
│   │   ├── update/
│   │   │   ├── constants.ts       # GITHUB_REPO, RELEASES_API_URL, INSTALL_SCRIPT_URL, TTL, cache path
│   │   │   ├── parseVersion.ts    # semver-light parser
│   │   │   ├── compareVersions.ts # semver §11 precedence
│   │   │   ├── fetchLatestVersion.ts # GitHub Releases API, Result tagué, AbortSignal
│   │   │   ├── cache.ts           # ~/.chiro/update-check.json : read/write atomique + isCacheFresh
│   │   │   └── checkForUpdate.ts  # orchestrateur cache → fetch → compare, silent fail
│   │   ├── logging/
│   │   │   ├── log.ts             # append JSONL dans ~/.chiro/sessions.jsonl
│   │   │   └── log.test.ts        # snapshot byte-stable v1 (vigie-prefix) + v2 (vigie-process)
│   │   └── e2e.test.ts            # round-trip complet sur dossier mkdtemp
│   └── types.ts                   # types partagés (FormInput, RenamePlan, …)
├── .eslintrc.cjs (ou eslint.config.js)
├── .gitignore
├── .prettierignore
├── .prettierrc
├── package.json                   # bin: { chiro: "src/index.tsx" } (en dev), version inj. à la compile
├── tsconfig.json
├── vitest.config.ts
└── README.md                      # racine — utilisateur final (install + usage rapide)
```

### Principes de séparation

- **`src/lib/`** : 100% TypeScript pur, **aucun import** de `ink`, `react`, ni `ink-text-input`. Tout est testable en `vitest` sans rendu Ink. Cible : couverture 100%.
- **`src/screens/`** : composants Ink qui orchestrent. Ils appellent `lib/`, jamais l'inverse. Pas de logique métier ici (si elle dépasse 5 lignes, elle migre dans `lib/`).
- **`src/components/`** : composants Ink réutilisables (visuel). Pas de logique non plus.
- **`src/types.ts`** : types partagés (entrées formulaire, plan de renommage, événement de log). Pas de comportement.

## State machine (`src/app.tsx`)

```ts
type Screen =
  | { kind: "menu" }
  | { kind: "update" }
  | { kind: "vigie:constat" }
  | { kind: "vigie:form" }
  | { kind: "vigie:confirm"; input: FormInput; plan: RenamePlan }
  | { kind: "vigie:result"; outcome: RenameOutcome }
  | { kind: "process:constat" }
  | { kind: "process:form"; wavFiles: string[] }
  | { kind: "process:confirm"; input: ProcessInput; wavFiles: string[] }
  | { kind: "process:result"; input: ProcessInput; outcome: ProcessOutcome };
```

Transitions :

```
menu --select "Préfixer"--> vigie:constat
menu --select "Découper"--> process:constat
menu --select "Mettre à jour"--> update
update --Échap--> menu
update --confirm install--> onRequestUpdate() + exit() → post-Ink spawn install.sh

# Flow Préfixer (Phase 1–3)
vigie:constat --Entrée--> vigie:form  (si .wav trouvés et writable)
vigie:constat --Échap--> menu
vigie:form --submit--> vigie:confirm (calcule le plan)
vigie:form --Échap--> vigie:constat
vigie:confirm --Entrée--> applyRenames → vigie:result
vigie:confirm --Échap--> vigie:form
vigie:result --Entrée--> menu

# Flow Découper (Phase 5)
process:constat --Entrée--> process:form  (si .wav trouvés, processed/ vide, espace OK)
process:constat --Échap--> menu
process:form --submit--> process:confirm
process:form --Échap--> process:constat
process:confirm --Entrée--> processWavFiles → process:result (+ logSession v2)
process:confirm --Échap--> process:constat
process:result --Entrée--> menu
```

L'`App` tient le state via `useState<Screen>` et passe des callbacks aux écrans. Pas de Redux, pas de Context, pas de routeur.

**Auto-check au boot** : un `useEffect` au mount d'`App` lance `checkForUpdate({ currentVersion: CHIRO_VERSION })` (test seam : `bootChecker?` injectable). Le résultat est stocké dans `availableVersion: string | null` et passé à `MenuScreen` qui affiche le hint jaune si non-null. Cleanup avec `AbortController` + flag `cancelled` au démontage.

**Pattern drapeau post-Ink** : pour lancer `install.sh` proprement, on ne spawn pas pendant que Ink dessine (stdout serait contesté). À la place :

1. `App` reçoit une prop `onRequestUpdate: () => void` depuis `index.tsx`.
2. Sur confirmation d'install dans `UpdateScreen`, App appelle `onRequestUpdate()` puis `useApp().exit()` synchronement.
3. Dans `index.tsx`, le callback pose un drapeau interne ; après `await render(...).waitUntilExit()`, si le drapeau est posé, on lance `spawnSync("bash", ["-c", "curl -fL ${INSTALL_SCRIPT_URL} | bash"], { stdio: "inherit" })` puis `process.exit(proc.status ?? 0)`.
4. Ink est unmount avant le spawn, donc stdout/stderr sont libres pour `install.sh`.

### Contrat `install.sh`

`UpdateScreen` invoque `install.sh` depuis `main` via `INSTALL_SCRIPT_URL`. Tant que ce contrat tient, l'update fonctionne :

- **URL stable** : `https://raw.githubusercontent.com/zaratan/chiro-tools/main/scripts/install.sh` ne doit jamais bouger.
- **Pas d'interactivité** : le script ne lit jamais stdin (pas de `read -p`, pas de prompt sudo).
- **Cible fixe** : place le binaire dans `~/.local/bin/chiro` (ou respecte `$CHIRO_INSTALL_DIR` si fourni).
- **Idempotent** : ré-exécuter le script doit produire le même état final.
- **Exit code 0 = succès, autre = échec** : `chiro` propage ce code via `process.exit(proc.status ?? 0)`.
- **Pas de quarantine attribute** : assumé OK car `curl | bash` ne pose pas l'attribut com.apple.quarantine.

Toute PR touchant `install.sh` doit re-cocher ce contrat manuellement.

## Build

### Dev

```bash
bun src/index.tsx                  # exécute directement, hot reload manuel
```

### Tests

```bash
bun run test                       # vitest
bun run test:watch                 # vitest watch
```

**Versioning runtime** : `src/version.ts` importe `version` depuis `package.json`. Bun inline le JSON dans le bundle lors de `bun build --compile`, et le lit directement en mode `bun src/index.tsx`. Pas de `--define` à maintenir, single source of truth = `package.json`.

### Binaire de release (par cible)

```bash
# macOS arm64
bun build src/index.tsx \
  --compile \
  --target=bun-darwin-arm64 \
  --outfile=dist/chiro-darwin-arm64

# Linux x64
bun build src/index.tsx \
  --compile \
  --target=bun-linux-x64 \
  --outfile=dist/chiro-linux-x64
```

Bun embarque le runtime (~50 MB par binaire). Aucune dépendance utilisateur.

## Signature macOS

L'auteur dispose d'un **compte Apple Developer**. Le binaire macOS est signé Developer ID + notarisé avant publication.

Étapes (Phase 4, dans la CI ou en local) :

```bash
# 1. Signer
codesign --sign "Developer ID Application: <Nom> (<TeamID>)" \
  --options runtime \
  --timestamp \
  dist/chiro-darwin-arm64

# 2. Empaqueter pour notarytool (un zip suffit)
zip dist/chiro-darwin-arm64.zip dist/chiro-darwin-arm64

# 3. Notariser
xcrun notarytool submit dist/chiro-darwin-arm64.zip \
  --apple-id "<email>" \
  --team-id "<TeamID>" \
  --password "<app-specific-password>" \
  --wait

# 4. (Optionnel mais propre) Stapler — non applicable à un binaire CLI nu
# Si on empaquetait dans un .app ou .dmg : xcrun stapler staple
```

L'identifiant exact du certificat et le team ID seront demandés au moment de mettre en place la Phase 4. **Ne pas hardcoder** ces valeurs dans le repo — utiliser GitHub Secrets.

## Distribution

### MVP (Phase 4)

- **GitHub Releases** héberge les 2 binaires (`chiro-darwin-arm64`, `chiro-linux-x64`).
- **`scripts/install.sh`** dans le repo :

```bash
#!/usr/bin/env bash
set -euo pipefail

OS="$(uname -s)"
ARCH="$(uname -m)"
VERSION="${1:-latest}"

case "$OS-$ARCH" in
  Darwin-arm64)     ASSET="chiro-darwin-arm64" ;;
  Linux-x86_64)     ASSET="chiro-linux-x64" ;;
  *)                echo "Plateforme non supportée : $OS $ARCH" >&2 ; exit 1 ;;
esac

URL="https://github.com/<owner>/chiro-tools/releases/${VERSION}/download/${ASSET}"
DEST="${HOME}/.local/bin/chiro"
mkdir -p "$(dirname "$DEST")"
curl -fL "$URL" -o "$DEST"
chmod +x "$DEST"
echo "chiro installé dans $DEST"
echo "Assurez-vous que $(dirname "$DEST") est dans votre PATH."
```

- L'utilisatrice (ou son conjoint dév) lance :
  ```bash
  curl -fL https://raw.githubusercontent.com/<owner>/chiro-tools/main/scripts/install.sh | bash
  ```
- Une fois `~/.local/bin` dans `$PATH`, `chiro` est disponible globalement.

### V2 (différé)

- **Brew tap perso** (`homebrew-chiro`) — formula tire les mêmes assets depuis les GH Releases.
- Auto-update intégré (notification "version X.Y disponible" au boot).
- Linux arm64, macOS Intel x64.

## Logging

- Fichier : `~/.chiro/sessions.jsonl` (créer `~/.chiro/` au boot s'il n'existe pas).
- Format : **JSONL** (un objet JSON par ligne, `\n` séparateur).
- Mode : **append** (`fs.appendFile`). Jamais tronqué au MVP.
- Schéma : cf. `spec.md` § "Logging local".
- Une seule entrée par run de wizard (à la fin, succès OU échec OU interruption).
- **`SessionEvent` est une union discriminée sur `schema_version`** :
  - `v1` → action `vigie-prefix` (wire format **byte-stable** — assertion par snapshot test, toute modif accidentelle fait échouer `pnpm check`)
  - `v2` → action `vigie-process` (introduit en Phase 5)
- Lecteurs jq aval peuvent brancher sur `.schema_version` plutôt que sur `.action` pour une compatibilité future-proof.

## Lib audio (Phase 5)

### Séparation pure / I/O

`src/lib/audio/splitWavFile.ts` est un **générateur sync** sans I/O :

```ts
function* splitWavFile(buffer: Uint8Array, opts): Generator<
  | { kind: "chunk"; chunk: EncodedChunk }
  | { kind: "abort" }
  | { kind: "error"; code: SplitErrorCode }
>;
```

Il prend un `Uint8Array` (= contenu lu d'un .wav) et yield un chunk encodé à la fois — la mémoire ne tient jamais plus d'un chunk décodé + un chunk encodé.

`src/lib/audio/processWavFiles.ts` est l'**orchestrateur I/O** :

1. `mkdir -p <cwd>/processed/`.
2. Pre-clean `processed/*.tmp` orphelins d'un run interrompu (best-effort).
3. Pour chaque fichier source :
   - filtre regex `_\d{3}\.wav$` → `skippedAlreadyChunked` (évite de re-splitter des chunks déplacés à la racine)
   - `fstat`, si `size > maxInputBytes (500 MB)` → `skippedTooLarge`
   - `readFile`, puis `for (const yielded of splitWavFile(...))`
   - chaque chunk passe par `writeFileAtomic` (`.tmp` puis `rename`, fallback `EXDEV`)
4. Retourne `ProcessOutcome` avec processed / errored / skipped / interrupted / durationMs.

### Non-destructivité — invariants garantis

Le contrat « originaux jamais touchés » est garanti par construction :

- `splitWavFile` ne fait **aucune** I/O ; il n'a même pas connaissance du chemin source.
- `processWavFiles` n'exécute **aucun** `unlink` / `rename` / `writeFile` sur un path source. Tous les writes vont dans `<cwd>/processed/`.
- L'écriture atomique opère à l'intérieur de `processed/` (`chunk_NNN.wav.tmp` → `chunk_NNN.wav`). Le path source ne devient jamais un `.tmp`.
- Tests (`processWavFiles.test.ts` : « does not modify the source file ») asserte byte-equality des sources avant/après run. Intégration sur AudioMoth 149 MB asserte idem.

### Allowlist de formats

`splitWavFile` accepte uniquement :

- `audioFormat === 1` (PCM linéaire standard)
- `audioFormat === 0xFFFE` (`WAVE_FORMAT_EXTENSIBLE`) avec `subformat` PCM (préfixe `[0x01, 0x00]`)
- bit depth 16 ou 24 (16 = `Int16Array`, 24 = `Int32Array` côté wavefile)

Tout autre format (float, A-law, µ-law, ADPCM) retourne `{ kind: "error", code: "unsupported-format" }`. Volontairement strict : la chaîne Vigie-Chiro/Tadarida ne traite que des PCM entiers.

### Quirks `wavefile` à connaître

1. **`getSamples(false, IntXXArray)`** retourne :
   - un `IntXXArray` plat pour le mono
   - un `IntXXArray[]` (un par canal) pour le multichannel
     → toujours normaliser en `IntXXArray[]` avant de slicer.
2. **`fmt`** est typé `object` côté wavefile, mais runtime expose `audioFormat`, `numChannels`, `sampleRate`, `byteRate`, `blockAlign`, `bitsPerSample`, `cbSize`, `validBitsPerSample`, `dwChannelMask`, `subformat`. Cast local en type explicite, jamais `any`.
3. **`bitDepth`** est une **string** (`"16"`, `"24"`, `"32"`, `"32f"`, `"64"`) — pas un number. Le constructeur `fromScratch` attend cette string.
4. **Chunks `LIST` / `INFO` / `ICMT` (metadata AudioMoth)** : présents sur l'input, **non préservés** par `fromScratch` au re-encode. Comportement aligné avec Kaleidoscope. À documenter si un consommateur aval s'en plaint.

### ETA tracker (byte-weighted)

`src/lib/audio/etaTracker.ts` expose un petit utilitaire pur (zero import Ink/React) qui suit la progression d'un batch en termes d'octets traités plutôt qu'en compte de fichiers. Approche choisie après lead-eng review : robuste à l'hétérogénéité des batches Vigie-Chiro (mix AudioMoth 143 MB + Teensy 4 MB).

API :

- `createETATracker(bytesTotal, nowMs?)` — instancie un tracker avec le volume total connu d'avance (via les `stats.size` cumulés calculés dans `estimateChunkCount` côté UI).
- `markFileDone(tracker, fileSizeBytes)` — appelé à chaque `file-done`.
- `estimateRemainingMs(tracker, nowMs?)` — `null` tant que `bytesDone === 0`, sinon `elapsedMs × (bytesRemaining / bytesDone)`.
- `elapsedMs(tracker, nowMs?)` — temps écoulé depuis création (monotone via `performance.now()`).

`nowMs?` injectable pour faciliter les tests avec une fake clock.

### Pattern `useProgressState` (hook UI)

`src/screens/vigie-process/useProgressState.ts` colocalise la complexité throttle/ETA hors de `ConfirmScreen`. Le hook expose :

```
{
  state: ProgressState,         // snapshot rendu (rate-limited)
  onProgress: (event) => void,  // passé en option à processWavFiles
  finalizeRender: () => void,   // appelé SYNCHRONEMENT avant onComplete()
}
```

Internement :

- `progressRef` (mutable, hors cycle React) accumule chaque event.
- `setState` est appelé **systématiquement** sur `file-start` et `file-done` (changement de fichier ou de progression coarse), et **rate-limited** sur `chunk-written` (~10 Hz, 100 ms entre frames).
- `finalizeRender()` flush un dernier `setState` synchrone avec `chunksWritten = totalChunksEstimate` — force la barre à 100 % juste avant l'unmount. Ne JAMAIS l'appeler depuis un cleanup `useEffect` (setState post-unmount = bug React).

`onProgress` et `finalizeRender` sont stables (`useCallback([])`), donc safe à passer dans les options de `processWavFiles` sans re-render.

### Drift watch — `ConfirmScreen.tsx`

Le screen accumule maintenant : preview + run + progression + ETA + abort + log + state machine. Une prochaine modification non-triviale (ex : ajout d'une option de configuration, d'un step de validation supplémentaire) doit déclencher l'extraction d'un hook `useVigieProcessRun()` qui owne le controller d'abort, le `runningRef`, le `logSession`, et l'estimation. À la même occasion, migrer `estimateChunkCount` (logique audio domain actuellement inlinée dans le screen) vers `src/lib/audio/` — la layer rule de CLAUDE.md voudrait qu'elle y vive déjà, mais l'extraction est différée tant qu'elle a un seul consommateur. `ConfirmScreen` ne ferait alors plus que le rendu. Aujourd'hui le screen reste tolérable mais à la limite haute du raisonnable pour un screen unique.

## Performance pipeline (Phase 6)

Le découpage est CPU-bound : `wavefile.toBuffer()` ré-encode header + samples par chunk (~30–50 ms × 5–6 chunks × N fichiers). Sur dataset réel (9301 fichiers AudioMoth/Teensy déjà préfixés), le pipeline mono-thread initial prend ~3h30. Phase 6 livre deux optimisations cumulables : worker pool wavefile (toujours actif) et fast-path sox (opt-in).

### Pipeline A — Worker pool wavefile

`src/lib/audio/splitWorkerPool.ts` orchestre N workers `node:worker_threads` qui exécutent chacun `splitWavFile` sur un fichier dédié. Le pool fait la queue files-as-tasks, dispatche au prochain worker idle, agrège les `ProgressEvent` avec throttle 100 Hz. Gain attendu 3–6× selon la machine.

`N` calculé dynamiquement au mount :

```ts
const N = Math.max(
  2,
  Math.min(
    Math.floor((totalMB * 0.7) / 400), // 400 MB pic / worker AudioMoth
    cpuCount - 1, // 1 core libre pour main + UI
    12, // hard cap : I/O contention + GC
  ),
);
```

Surchargeable via `CHIRO_WORKER_COUNT`. Pour M1 Max 64 GB / 10 cores → N=9. MacBook 16 GB / 8 cores → N=7.

**Abort propre** : sur signal, le main poste `{kind:"abort"}` à chaque worker, attend leur `{kind:"aborted"}` (timeout 2s), puis `worker.terminate()` forcé pour les retardataires. Garantie principale : à la sortie de `run()`, aucun chunk `.tmp.*` n'est laissé sur disque (le worker finit son `await rename` en cours avant de répondre `aborted`). Suffixe tmp en `crypto.randomUUID().slice(0,8)` (workers partagent le PID parent → collision possible avec `.tmp.${PID}`).

**Second safety net** : `preCleanOrphanTmps(outDir)` est appelé au démarrage de chaque `run()`, qui supprime tout `.tmp` orphelin laissé par un run précédent (cas où un worker aurait été tué brutalement avant la fin de son `await rename`, par exemple sur SD lente où le timeout 2s aurait été atteint). Le pre-clean garantit que le `processed/` est toujours dans un état cohérent avant un nouveau batch — pas de chunk corrompu visible côté utilisatrice.

### Pipeline B — Fast-path sox

`src/lib/audio/soxFastPath.ts` : si `sox` détecté au boot via `Bun.which("sox")` + `spawnSync sox --version` exit 0 (et `CHIRO_DISABLE_FASTPATH` non set), `runSoxBatch` remplace le worker pool. Gain attendu ~22× wall sur AudioMoth (PoC : 1802/1802 chunks bit-exact validés).

Pour chaque fichier : spawn `sox <src> <outDir>/<baseName>_raw_.wav trim 0 <segmentSeconds> : newfile : restart`. Pool de N spawns concurrents (même heuristique que A). Après spawn : `rewriteHeaderToStandardPcm(chunk, expand10x)` sur chaque chunk produit. ATTENTION : pour `expand-10x`, on passe `expand10x=true` côté sox (sox écrit la sampleRate source dans le header, doit être divisée) alors que côté worker pool wavefile on passe `expand10x=false` (wavefile a déjà encodé le bon rate).

### Header canonique unifié (cohérence A/B)

`src/lib/audio/wavHeader.ts` exporte `rewriteHeaderToStandardPcm(filePath, expand10x)`. Appliqué dans les **deux** pipelines après le split : strip `LIST/INFO/JUNK/fact`, force `audioFormat=1` PCM standard, écrit un header 44-byte canonical, préserve la zone `data` byte-pour-byte. Conséquence : A et B produisent des fichiers bit-identiques (un seul SHA256 golden test, un seul format de sortie). Validé par `__tests__/golden.test.ts`.

### Métadonnées GUANO + wamd

`src/lib/audio/finalizeChunk.ts` wrappe `rewriteHeaderToStandardPcm` puis appelle `appendAncillaryChunks(filePath, chunks)` pour appender les RIFF ancillaires après la zone `data`. La fonction recalcule la `RIFF size` à offset 4 et insère 1 byte `0x00` de padding si `dataSize` est impair (alignement 2-byte). Chaque chunk passé est lui-même 2-byte aligné.

Les builders vivent dans `src/lib/audio/metadata/` :

- `guano.ts` — sérialise un `GuanoMeta` en chunk `guan` UTF-8 (GUANO 1.0).
- `wamd.ts` — sérialise un `WamdMeta` en chunk `wamd` Wildlife Acoustics (records `tag(2 LE)+length(4 LE)+value`, pas de header).
- `chunkMetadata.ts` — orchestrateur per-chunk : reçoit `(sourceTimestamp, chunkIndex, chunkSamples, outputSampleRate, …)` et produit le `(guano, wamd)` correspondant. `Length` = `chunkSamples / outputSR / timeExpansion` (secondes réelles). `Timestamp` = `sourceTs + chunkIndex × 5 s`.

Pipeline worker pool (A) : `splitWorker.writeTmpAndRename` appelle `finalizeChunk(tmp, { expand10x: false, ancillaries: [wamd, guano] })`. Pipeline sox (B) : `processOneFile` appelle `rewriteHeaderToStandardPcm` puis lit `dataSize` du header canonique pour calculer `chunkSamples` avant `appendAncillaryChunks`. Les deux pipelines produisent des bytes identiques (validé par run manuel sur `test-data/real_process_teensy/`).

Le kill-switch `CHIRO_DISABLE_METADATA=1` est lu dans `ConfirmScreen.tsx` au démarrage de la session ; il est propagé via `ProcessOptions.metadata.enabled = false`. État tracé dans `SessionEvent.result.metadata: "full" | "off"`. Le timestamp source est parsé depuis le filename (`src/lib/files/parseTimestamp.ts`) — pattern `_YYYYMMDD_HHMMSS` ancré pour éviter de matcher l'année du préfixe Vigie-Chiro (`Car…-2026-…`). Si non parsable, la ligne `Timestamp:` est omise du GUANO et le record `0x0005` est omis du wamd.

### Routage et politique fallback

`processWavFiles.ts` route selon `options.sox` (passé par `App.tsx` après `detectSox`) :

```ts
if (sox) {
  const r = await soxFastPath.runSoxBatch(
    sox.binPath,
    files,
    dir,
    input,
    options,
  );
  if (r.kind === "fallback") {
    logSessionFallback(r.reason);
    return splitWorkerPool.run(files, dir, input, options);
  }
  return r.outcome;
}
return splitWorkerPool.run(files, dir, input, options);
```

**Politique per-batch first-error** : si sox crashe OU si spot-check échoue sur le 1er fichier, **tout le batch** retraite via le worker pool (pas de mix per-file). Un seul invariant à vérifier, pas de drift inter-pipeline au sein d'un batch. Si sox foire seulement à partir du fichier #3 (le 1er a validé), c'est probablement un fichier corrompu — log warning, ajoute à `errored`, continue le batch. `SessionEvent.result.engine` et `engine_fallback_count` enregistrent le pipeline réellement utilisé.

### Safety nets (priorité données scientifiques)

1. **Header canonique unique A/B** (cf. ci-dessus) — invariant testable.
2. **Spot-check stratifié** sur le 1er fichier sox : 3 chunks (1er, milieu, dernier) décodés via wavefile, comparaison de 100 samples à la formule attendue. Mismatch → fallback immédiat du batch.
3. **Golden CI test** (`__tests__/golden.test.ts`) sur 2 fixtures (AudioMoth-class + 24-bit stéréo) avec SHA256 hardcodés. CI matrix `sox: [with, without]` couvre les deux pipelines.
4. **Env opt-out** `CHIRO_DISABLE_FASTPATH=1` : force le worker pool même si sox détecté. Utile pour debug et reproductibilité.

### Asset embedding pour les workers (`bun --compile`)

`splitWorker.ts` (source TS strict) est pré-bundlé via `bun build` (`pnpm build:worker`, hooked en `predev`/`pretest`/`prebuild`/`precheck`) en `splitWorker.bundled.mjs`. Ce bundle est embarqué dans le binary compilé via :

```ts
import workerBundleAsset from "./splitWorker.bundled.mjs" with { type: "file" };
```

Sans le `with { type: "file" }`, `bun --compile` ne suit pas l'import et le binary tombe en `ModuleNotFound /$bunfs/root/splitWorker.bundled.mjs` au runtime. Vitest n'honore pas l'import assertion → fallback runtime via `fileURLToPath(new URL(".", import.meta.url))`. Le pattern complet (avec narrow `typeof asset === "string"`) est dans `resolveWorkerPath()` de `splitWorkerPool.ts`.

Le bundle est gitignored + dans `ignores` eslint + déclaré dans `src/types/asset-imports.d.ts` (ambient `declare module "*.bundled.mjs"`). Toujours regen avant chaque run → aucun drift dev/prod possible.

### Pourquoi sox et pas ffmpeg

Le PoC initial (`scripts/poc-*.ts`) testait ffmpeg ET sox. Résultat sur 1802 chunks AudioMoth + synthétiques :

- **sox + rewrite header** : 1802/1802 MATCH bit-exact, 22× wall, samples préservés.
- **ffmpeg `-f segment -c copy`** : 0/1802 MATCH. ffmpeg paquetise le PCM par blocs internes de ~131072 samples (~0.524s @ 250 kHz au lieu de 0.5s cible). Les frontières de chunks ne peuvent pas être alignées au sample près sur du stream-copy PCM — limitation architecturale du muxer segment pour codecs raw. Pas de patch possible sans re-encoding (qui réintroduit du risque de dither). **ffmpeg définitivement écarté pour notre usage**.

Si un futur use case justifie ffmpeg (un autre format que PCM), repartir du PoC dans `scripts/poc-*.ts` pour re-valider bit-exact.

### ETA — moyenne glissante 5 fichiers

`etaTracker.ts` calcule l'ETA sur les **5 derniers fichiers** (au lieu du cumulé global `bytesDone / elapsedMs`). Avec sox + workers, certains fichiers finissent en sub-seconde — la moyenne cumulée devient yo-yo, la glissante absorbe. Wording UX `Encore environ X` (avec "environ") reste calibré, pas d'ajout "estimation peut varier".

### Moteur silencieux dans la TUI

Aucun affichage de "Moteur : sox" / "Moteur : interne" dans `RunningView`. Décision UX actée (cf. `docs/ux.md` § Choix UX validés). Le pipeline utilisé est tracé dans `~/.chiro/sessions.jsonl` (`engine`, `engine_fallback_count`) pour diagnostic dev.

## Configuration (V2)

Pas de configuration utilisateur au MVP. En V2, `~/.config/chiro/last-session.json` stockera les derniers carré et code point pour pré-remplissage. À ne PAS implémenter au MVP.

## CI

Deux workflows GitHub Actions :

- **`ci.yml`** : déclenché sur push et pull_request.
  - Job `check` : `pnpm check` sur **Linux uniquement**. `src/lib/` est pur TS/Node, pas de code platform-specific — dupliquer sur macOS gaspille ~30 s + 450 MB de LFS bandwidth par PR. Tests d'intégration sur fichiers réels `test-data/` → requiert `actions/checkout@v6` avec **`lfs: true`**.
  - Job `smoke-build` (matrix macOS arm64 + Linux x64) : compile et exécute `--version` + `--help`. Valide que `bun --compile` bundle proprement les 2 cibles. Pas de LFS.
- **`release.yml`** : déclenché sur tag `v*.*.*`. Build les 2 binaires, (optionnel) signe+notarise le macOS, crée la GitHub Release avec les 2 assets. Pas besoin de LFS — ne lance pas `pnpm test`.

Note : le smoke test post-build TUI complet (golden path interactif) nécessiterait un PTY simulé (`script -q /dev/null`, `unbuffer`) — différé en V2. Aujourd'hui le smoke test se limite aux commandes non-interactives `--version` et `--help` qui suffisent à valider que le binaire `bun --compile` charge proprement (incluant le bundle wavefile).

## Tests — stratégie

### Critiques (à écrire en Phase 1)

1. **`prefix.test.ts`** : tous les cas du format, dont :
   - Cas nominal `040962 / 2026 / 3 / A1` → `Car040962-2026-Pass3-A1-`
   - Département 1-9 padding : `06...` accepté, `6...` rejeté en validation
   - Point en minuscule normalisé (`a1` → `A1`)
   - Passage 1, 99, 100
2. **`isAlreadyPrefixed.test.ts`** : matche/ne matche pas la regex de la spec.
3. **`scanWavFiles.test.ts`** : avec un dossier temporaire (`fs.mkdtemp`), vérifier filtre `.wav`/`.WAV`/dotfiles/dirs/symlinks.
4. **`planRenames.test.ts`** : idempotence, collisions sur disque, ordre alphabétique stable, casse `.WAV` → `.wav`.
5. **`applyRenames.test.ts`** : succès, fallback EXDEV simulé (mock `fs.rename` qui throw `EXDEV` → vérifier copyFile+unlink appelés), erreur partielle (un fichier renommé puis EACCES sur le suivant → résultat partiel cohérent).
6. **`e2e.test.ts`** : test round-trip complet — créer `mkdtemp` avec 10 fichiers variés (`.wav`, `.WAV`, déjà préfixé, accents, espaces, non-wav), invoquer le flux `scan → plan → apply`, asserter l'état final du disque.

### Best-effort (Phase 2)

- 1 parcours nominal Form → Confirm → Result via `ink-testing-library`. Pas de couverture exhaustive des écrans.

## Risques techniques à surveiller en Phase 0

1. **Bun + Ink 6 + React 19 + `bun --compile`** : combo non éprouvé publiquement. Si le binaire compilé crashe au démarrage (`yoga-wasm-web` ou autre), fallback :
   - Plan B : Node + tsup + binaire via `@yao-pkg/pkg` ou Node SEA.
   - Plan C : distribution `pnpm i -g` (utilisateur doit avoir Node).
2. **Cross-device `fs.rename`** : tester explicitement le fallback EXDEV avec une SD card réelle pendant la recette finale.
3. **TTY sur certains émulateurs** (iTerm2, Terminal.app, Warp, kitty) : vérifier le rendu Ink sur au moins iTerm2 et Terminal.app.
4. **Encodages de noms de fichiers** : tester avec accents (`é`), espaces, emoji. Node 24 gère en UTF-8, mais HFS+ vs APFS peut différer sur la normalisation (NFC vs NFD). Au MVP, ne pas normaliser — Node restitue ce que le FS donne.
