# Roadmap

Le MVP est découpé en **5 phases** (0 à 4) + V2. Chaque phase a un **critère de sortie** clair. On ne démarre pas la phase suivante tant que la précédente n'est pas validée manuellement par l'utilisateur.

## Phase 0 — Outillage et validation de la stack ✓

**Objectif** : s'assurer que la stack tient avant d'investir sur le code métier. Cette phase est délibérément en premier (pas en dernier) : si `bun --compile` ne marche pas avec Ink 6 + React 19, on doit le savoir avant d'écrire 1000 lignes de code.

**Cible Phase 0 : macOS arm64 NON signé uniquement.** Linux x64 + signature/notarisation Apple sont reportés en Phase 4 (intégrés à la pipeline GitHub Actions).

### Tâches

1. `pnpm init`, `package.json` aligné sur les conventions arkham-proba (mono-package, sans `bin`, `engines.bun`).
2. `tsconfig.json` strict (avec `noUncheckedIndexedAccess`), `vitest.config.ts`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.gitignore` (incl. `*.tsbuildinfo`).
3. Husky + lint-staged (pre-commit = `lint-staged && typecheck`).
4. Dépendances : `ink`, `ink-text-input`, `react`, `react-devtools-core` (devDep — nécessaire pour `bun --compile` car Ink l'importe statiquement). DevDeps tooling : `typescript`, `vitest`, `ink-testing-library`, `eslint`, `prettier`, etc.
5. Arborescence `src/lib/`, `src/screens/`, `src/components/` avec `.gitkeep`.
6. `src/index.tsx` Hello Ink **vraiment représentatif** : `useState`, `useInput`, `readdirSync(".")` — pour tester yoga-wasm-web et Bun SEA, pas un Hello statique.
7. `src/smoke.test.ts` trivial pour valider vitest.
8. Valider la chaîne dev : `pnpm dev`, `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`.
9. Mode dev hot-reload : `pnpm dev:watch` (`bun --watch`).
10. **Build binaire macOS arm64** : `pnpm build:darwin-arm64` → `dist/chiro-darwin-arm64` (~62 MB).
11. Tester `./dist/chiro-darwin-arm64` localement (post `xattr -d com.apple.quarantine` si Gatekeeper bloque) → TUI s'affiche, espace incrémente, q/Échap quitte, `readdirSync` reflète le cwd.
12. **README.md racine** minimal + mise à jour `docs/roadmap.md`.

### Critère de sortie

- [x] `pnpm dev` affiche la TUI Ink interactive avec compteur.
- [x] `dist/chiro-darwin-arm64` NON signé lancé localement affiche la TUI, incrémente, quitte, et lit le cwd.
- [x] `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check` passent tous.
- [x] Pre-commit husky bloque un commit avec une erreur lint ou tsc.

**Si bloquant** : plan B documenté = Node + tsup + `@yao-pkg/pkg` ; ou abandon `bun --compile` au profit de `pnpm i -g` côté distribution.

## Phase 1 — Logique métier pure (TDD)

**Objectif** : implémenter et tester toute la couche `src/lib/` en TDD, sans toucher à Ink. À la fin de cette phase, on a un moteur 100% testé qui sait scanner un dossier, planifier des renommages, et les exécuter.

### Tâches (par ordre TDD)

1. `lib/vigie-chiro/validation.ts` + tests : 4 validators (carre, annee, passage, point).
2. `lib/vigie-chiro/prefix.ts` + tests : construction du préfixe.
3. `lib/vigie-chiro/isAlreadyPrefixed.ts` + tests.
4. `lib/fs/scanWavFiles.ts` + tests (`mkdtemp` fixtures : .wav, .WAV, .txt, dotfile, sous-dossier).
5. `lib/fs/planRenames.ts` + tests : idempotence, collisions au plan-time, ordre alphabétique, normalisation `.WAV → .wav`.
6. `lib/fs/applyRenames.ts` + tests : succès, fallback EXDEV (mock), erreur partielle, ordre séquentiel.
7. `lib/logging/log.ts` + tests : append JSONL, création du dossier.
8. `lib/e2e.test.ts` : round-trip complet sur dossier temporaire.

### Critère de sortie

- [ ] Couverture `src/lib/` ≥ 95% (cible 100%).
- [ ] Le test E2E `lib/e2e.test.ts` passe et reflète un scénario réaliste.
- [ ] `bun run test` complet en moins de 5 secondes.

## Phase 2 — UI Ink

**Objectif** : brancher la couche `lib/` à une TUI Ink fonctionnelle. À la fin, l'outil tourne en dev (`bun src/index.tsx`) avec un wizard utilisable de bout en bout.

### Tâches

1. `components/TextField.tsx` (label + `ink-text-input` + aide/erreur).
2. `components/Footer.tsx` (barre de raccourcis stylée, prop `hints: Array<{key, label}>`).
3. `screens/MenuScreen.tsx` (1 item + Quitter).
4. `screens/vigie-chiro/ConstatScreen.tsx` (appelle `scanWavFiles`, vérifie W_OK, R_OK).
5. `screens/vigie-chiro/FormScreen.tsx` (4 champs, focusedIndex, validation hybride).
6. `screens/vigie-chiro/ConfirmScreen.tsx` (appelle `planRenames`, affiche 3 exemples).
7. `screens/vigie-chiro/ResultScreen.tsx` (4 variantes A/B/C/D).
8. `app.tsx` (state machine et transitions).
9. `index.tsx` (boot : TTY check, `--version`, `--help`, args inattendus, puis `render(<App />)`).
10. Handler `SIGINT` global pendant `applyRenames` (cf. spec).
11. Logging à la fin de chaque session (succès/erreur/interruption).
12. 1 test `ink-testing-library` du parcours nominal (Constat OK → Form valide → Confirm → Result A).

### Critère de sortie

- [ ] `bun src/index.tsx` dans un dossier de test affiche le Menu.
- [ ] Parcours complet manuel : Menu → Constat → Saisie → Confirmation → Résultat avec renommage effectif sur disque.
- [ ] Ctrl+C pendant la saisie quitte proprement.
- [ ] Ctrl+C pendant le rename produit la variante D et laisse l'état correct.
- [ ] `~/.chiro/last-run.log` contient une entrée JSON valide par session.
- [ ] `chiro --version` affiche la version, `chiro --help` affiche l'aide.

## Phase 3 — Polish UX

**Objectif** : tous les wordings finalisés selon `ux.md`, ergonomie peaufinée, test utilisateur avec la conjointe.

### Tâches

1. Relecture mot à mot de chaque écran contre `ux.md` (ne JAMAIS reformuler à la volée).
2. Vérifier les couleurs (cyan/green/yellow/red/dimColor) sur 2 émulateurs minimum (iTerm2, Terminal.app).
3. Vérifier le rendu sur largeur de terminal 80 et 120 colonnes.
4. Vérifier `process.stdout.isTTY === false` (redirect stdout via fichier) → message stderr correct.
5. **Test utilisateur** : la conjointe utilise l'outil sur un vrai dossier de sa dernière nuit, sans aide. Observer (où elle hésite, où elle ne sait pas quoi taper). Itérer.

### Critère de sortie

- [ ] Tous les wordings matchent `ux.md` à la virgule près.
- [ ] La conjointe complète une session de bout en bout sans aide téléphonique en < 2 min (= critère de succès du `vision.md`).
- [ ] Aucun écran ne déborde de 70 colonnes ou ne casse en hauteur sur 24 lignes.

## Phase 4 — Distribution

**Objectif** : automatiser entièrement le build des binaires macOS arm64 et Linux x64 via GitHub Actions, publier en GitHub Releases, fournir un `install.sh` opérationnel. Linux x64 et signature sont traités ici (différés depuis Phase 0).

### Hypothèse signature Apple

Un binaire CLI distribué via `curl ... | bash` ne reçoit pas l'attribut `com.apple.quarantine` (pas de navigateur dans la chaîne). **On démarre sans signature.** Si un test sur machine vierge révèle un blocage Gatekeeper, la Phase 4.5 active la signature Developer ID + notarisation.

### Tâches (réalisées en 4A/4B/4C/4D)

- [x] `package.json` : scripts `build:linux-x64` + `build` (les 2 cibles en un coup) — **4A**
- [x] Build local du binaire Linux x64 (cross-compile depuis macOS via Bun) — **4A** (99 MB, ELF x86-64)
- [x] `scripts/install.sh` : détection OS/arch via `uname`, download atomique, warning PATH — **4B**
- [x] `.github/workflows/release.yml` : déclenché sur tag `v[0-9]+.[0-9]+.[0-9]+` (et `-suffix`), 3 jobs `build-macos` + `build-linux` + `release`, `typecheck` avant build, permissions least-privilege — **4C**
- [x] `.github/dependabot.yml` : updates mensuelles des actions GitHub — **4C**
- [x] `README.md` racine : section Installation avec one-liner curl + alternative auditable + variante `CHIRO_VERSION=...` — **4D**

### Étape conditionnelle Phase 4.5 — Signature Developer ID

Activer **uniquement si** un test sur machine vierge révèle un blocage Gatekeeper. L'utilisateur a un Apple Developer ID actif.

- Configurer les GitHub Secrets : `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_DEVELOPER_ID_CERT` (`.p12` en base64), `APPLE_DEVELOPER_ID_CERT_PASSWORD`.
- Étendre `release.yml` (job `build-macos`) avec une étape `codesign --sign "Developer ID Application: …" --options runtime --timestamp` puis `xcrun notarytool submit --wait`.
- Re-tag (`v0.1.1`) et re-tester.

### Critère de sortie

- [ ] Un tag `v0.1.0` (ou `v0.1.0-rc.1`) produit automatiquement les 2 binaires en GH Release.
- [ ] Une machine macOS arm64 vierge installe via curl one-liner et lance `chiro` (avec ou sans signature selon nécessité observée).
- [ ] Une machine Linux x64 vierge installe via le même curl one-liner et lance `chiro`.

**Action utilisateur restante** : pousser `git tag v0.1.0 && git push origin v0.1.0`, vérifier que les 3 jobs CI passent verts, puis tester l'install one-liner sur une machine vierge.

## Phase 4.6 — Self-update intégré ✓

**Objectif** : permettre à l'utilisatrice de mettre à jour chiro sans toucher au terminal. Item de menu **"Vérifier les mises à jour"** + auto-check silencieux au boot avec hint jaune si une version est dispo.

### Tâches (réalisées en 4.6 A/B/C/D)

- [x] `src/lib/update/` — logique pure : parseVersion, compareVersions, fetchLatestVersion (GitHub Releases API), cache disque 6 h, orchestrateur checkForUpdate. 100% coverage. — **4.6A**
- [x] `src/screens/UpdateScreen.tsx` + `updateErrorMessages.ts` — 4 états (checking / available / up-to-date / error), mapping FR pour 6 codes d'erreur. — **4.6B**
- [x] Intégration App + Menu + index — item de menu, hint jaune au boot, drapeau post-Ink, `spawnSync` d'`install.sh` avec stdio hérités. — **4.6C**
- [x] Documentation — `ux.md` (Écran 5 + mapping codes), `spec.md` (Écran 5 + flux post-Ink), `architecture.md` (arbo `lib/update/`, pattern drapeau post-Ink, contrat install.sh). — **4.6D**

### Critère de sortie

- [x] `pnpm check` vert, 227+ tests
- [ ] Test manuel : nouvelle version dispo sur GitHub → hint jaune apparaît au boot après ~1-2s
- [ ] Test manuel : Menu → "Vérifier les mises à jour" → Entrée → install se lance en sortie de Ink, ré-install bien le binaire

## V2 (post-MVP, hors scope)

Idées priorisées par valeur utilisateur :

1. **Pré-remplissage de la dernière session** (`~/.config/chiro/last-session.json`). Énorme gain UX pour utilisation nuit après nuit. Estimation : 2 h.
2. **Annuler la dernière opération** (journal `.chiro-undo.json` posé dans le dossier au moment du rename). Rassurance maximale. Estimation : 4 h.
3. **Lecture des métadonnées WAV** (date d'enregistrement, GPS si SM4+) pour auto-suggérer l'année et alerter en cas d'incohérence. Estimation : 1 j.
4. **Mode batch CLI** pour utilisateurs avancés : `chiro vigie --carre 040962 --pass 3 --point A1`. Estimation : 0.5 j.
5. **Brew tap perso** (`homebrew-chiro`) — formula pointant sur les GH Releases existantes. Estimation : 1 h.
6. **Linux arm64**, **macOS Intel x64**. Estimation : 1 h (juste 2 targets de build à ajouter).
7. **Internationalisation** (EN) si l'usage déborde le réseau Vigie-Chiro français.

## Définition de "Terminé"

Le MVP est livrable quand :

- Phases 0 à 4 ont leurs critères de sortie cochés.
- Le `README.md` racine permet à un naturaliste non-tech d'installer et d'utiliser l'outil sans intermédiaire technique.
- Le critère de succès du `vision.md` est tenu : **conjointe seule, < 2 min, sans peur**.
