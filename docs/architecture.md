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
│   │   └── vigie-chiro/
│   │       ├── ConstatScreen.tsx
│   │       ├── FormScreen.tsx     # focusedIndex + 4 <TextField> (numeric en mode managed)
│   │       ├── ConfirmScreen.tsx
│   │       └── ResultScreen.tsx
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
│   │   │   ├── planRenames.ts     # produit la liste {from, to, skipReason?}
│   │   │   ├── planRenames.test.ts
│   │   │   ├── applyRenames.ts    # séquentiel, fallback EXDEV, gestion SIGINT
│   │   │   └── applyRenames.test.ts
│   │   ├── update/
│   │   │   ├── constants.ts       # GITHUB_REPO, RELEASES_API_URL, INSTALL_SCRIPT_URL, TTL, cache path
│   │   │   ├── parseVersion.ts    # semver-light parser
│   │   │   ├── compareVersions.ts # semver §11 precedence
│   │   │   ├── fetchLatestVersion.ts # GitHub Releases API, Result tagué, AbortSignal
│   │   │   ├── cache.ts           # ~/.chiro/update-check.json : read/write atomique + isCacheFresh
│   │   │   └── checkForUpdate.ts  # orchestrateur cache → fetch → compare, silent fail
│   │   ├── logging/
│   │   │   ├── log.ts             # append JSONL dans ~/.chiro/sessions.jsonl
│   │   │   └── log.test.ts
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
  | { kind: "vigie:result"; outcome: RenameOutcome };
```

Transitions :

```
menu --select "Préfixer"--> vigie:constat
menu --select "Mettre à jour"--> update
update --Échap--> menu
update --confirm install--> onRequestUpdate() + exit() → post-Ink spawn install.sh
vigie:constat --Entrée--> vigie:form  (si .wav trouvés et writable)
vigie:constat --Échap--> menu
vigie:form --submit--> vigie:confirm (calcule le plan)
vigie:form --Échap--> vigie:constat
vigie:confirm --Entrée--> applyRenames → vigie:result
vigie:confirm --Échap--> vigie:form
vigie:result --Entrée--> menu
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

## Configuration (V2)

Pas de configuration utilisateur au MVP. En V2, `~/.config/chiro/last-session.json` stockera les derniers carré et code point pour pré-remplissage. À ne PAS implémenter au MVP.

## CI

Au MVP, **un seul workflow** GitHub Actions (Phase 4) :

- **`release.yml`** : déclenché sur tag `v*.*.*`. Build les 2 binaires, signe+notarise le macOS, crée la GitHub Release avec les 2 assets.

Pas de workflow CI par PR au MVP. Ajouter `check.yml` (lint + typecheck + test) si des collaborateurs externes arrivent.

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
