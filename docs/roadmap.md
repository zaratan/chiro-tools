# Roadmap

Le MVP est découpé en **5 phases** (0 à 4) + V2. Chaque phase a un **critère de sortie** clair. On ne démarre pas la phase suivante tant que la précédente n'est pas validée manuellement par l'utilisateur.

## Phase 0 — Outillage et validation de la chaîne de release

**Objectif** : s'assurer que la stack tient avant d'investir sur le code métier. Cette phase est délibérément en premier (pas en dernier) : si `bun --compile` ne marche pas avec Ink 6 + React 19, on doit le savoir avant d'écrire 1000 lignes de code.

### Tâches

1. `pnpm init`, `package.json` aligné sur les conventions arkham-proba (mono-package).
2. Installer Bun (si pas déjà).
3. `tsconfig.json` strict, `vitest.config.ts`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.gitignore`.
4. Husky + lint-staged.
5. Dépendances : `ink`, `react`, `ink-text-input`. DevDeps : `@types/react`, `@types/node`, `typescript`, `vitest`, `ink-testing-library`, `eslint`, `prettier`, etc.
6. `src/index.tsx` minimal : `<Text>Hello Vigie-Chiro</Text>` rendu par Ink, plus le shebang `#!/usr/bin/env bun`.
7. Vérifier `bun src/index.tsx` → affiche le Hello.
8. **Build binaire macOS arm64** : `bun build --compile --target=bun-darwin-arm64 --outfile=dist/chiro-darwin-arm64`.
9. **Signer** le binaire avec Developer ID + notariser via `notarytool`.
10. Tester `./dist/chiro-darwin-arm64` sur la machine de l'utilisateur → doit afficher Hello sans warning Gatekeeper, sans `clic droit → Ouvrir`.
11. **Build binaire Linux x64** : `bun build --compile --target=bun-linux-x64 --outfile=dist/chiro-linux-x64`.
12. Tester ce binaire dans un container Docker Linux (ou VM) → doit afficher Hello.
13. **README.md racine** minimal : 1 paragraphe d'intro + lien vers `docs/`.

### Critère de sortie

- [ ] `bun src/index.tsx` affiche `Hello Vigie-Chiro` localement.
- [ ] `dist/chiro-darwin-arm64` (signé+notarisé) lancé sur la machine de l'auteur ouvre sans warning et affiche le Hello.
- [ ] `dist/chiro-linux-x64` lancé dans Docker Linux affiche le Hello.
- [ ] `bun run test` lance vitest sur 1 test trivial (ex: `expect(1+1).toBe(2)`) et passe.
- [ ] `bun run lint` et `bun run format:check` passent.
- [ ] Pre-commit husky bloque un commit avec une faute de lint.

**Si bloquant** : décider du plan B (Node + tsup + pkg, ou Node + distribution npm) AVANT d'attaquer la Phase 1.

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

**Objectif** : automatiser le build des binaires signés + Linux et publier en GitHub Releases. Fournir un `install.sh` opérationnel.

### Tâches

1. Créer le repo GitHub `<owner>/chiro-tools` (s'il n'existe pas) et pousser.
2. Configurer les GitHub Secrets pour la signature macOS :
   - `APPLE_ID`
   - `APPLE_TEAM_ID`
   - `APPLE_APP_SPECIFIC_PASSWORD`
   - `APPLE_DEVELOPER_ID_CERT` (le `.p12` en base64)
   - `APPLE_DEVELOPER_ID_CERT_PASSWORD`
3. Écrire `.github/workflows/release.yml` : déclenché sur tag `v*.*.*`, build les 2 binaires, signe+notarise le macOS, crée la GH Release avec les 2 assets.
4. Écrire `scripts/install.sh` (cf. `architecture.md` § Distribution).
5. Documenter dans le `README.md` racine : `curl -fL https://raw.githubusercontent.com/<owner>/chiro-tools/main/scripts/install.sh | bash`.
6. **Tag `v0.1.0`** et vérifier la release de bout en bout.
7. Tester l'installation sur une machine vierge (VM ou collègue) avec la commande curl.

### Critère de sortie

- [ ] Un tag `v0.1.0` produit automatiquement les 2 binaires en GH Release.
- [ ] Le binaire macOS est notarisé (vérification : `spctl -a -vvv -t install ./chiro`).
- [ ] Une machine macOS arm64 vierge installe via curl one-liner et lance `chiro` sans warning.
- [ ] Une machine Linux x64 vierge installe via le même curl one-liner et lance `chiro`.

## V2 (post-MVP, hors scope)

Idées priorisées par valeur utilisateur :

1. **Pré-remplissage de la dernière session** (`~/.config/chiro/last-session.json`). Énorme gain UX pour utilisation nuit après nuit. Estimation : 2 h.
2. **Annuler la dernière opération** (journal `.chiro-undo.json` posé dans le dossier au moment du rename). Rassurance maximale. Estimation : 4 h.
3. **Lecture des métadonnées WAV** (date d'enregistrement, GPS si SM4+) pour auto-suggérer l'année et alerter en cas d'incohérence. Estimation : 1 j.
4. **Mode batch CLI** pour utilisateurs avancés : `chiro vigie --carre 040962 --pass 3 --point A1`. Estimation : 0.5 j.
5. **Brew tap perso** (`homebrew-chiro`) — formula pointant sur les GH Releases existantes. Estimation : 1 h.
6. **Linux arm64**, **macOS Intel x64**. Estimation : 1 h (juste 2 targets de build à ajouter).
7. **Auto-update** : notification "version X.Y disponible" au boot (check version GitHub). Estimation : 2 h.
8. **Internationalisation** (EN) si l'usage déborde le réseau Vigie-Chiro français.

## Définition de "Terminé"

Le MVP est livrable quand :

- Phases 0 à 4 ont leurs critères de sortie cochés.
- Le `README.md` racine permet à un naturaliste non-tech d'installer et d'utiliser l'outil sans intermédiaire technique.
- Le critère de succès du `vision.md` est tenu : **conjointe seule, < 2 min, sans peur**.
