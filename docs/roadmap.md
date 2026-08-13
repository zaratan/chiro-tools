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

## Phase 5 — Découper les enregistrements (split + TE ×10) ✓

**Objectif** : internaliser dans `chiro` les étapes Kaleidoscope du protocole Vigie-Chiro Point Fixe (expansion temporelle ×10 pour les détecteurs full-spectrum, puis découpe en fichiers de 5 secondes) — non-destructivement, dans un sous-dossier `processed/`. Référence canonique : `test-data/Tutoriel Vigie Chiro - Perso.pdf` (page 7).

### Tâches (réalisées en 5.A / 5.B / 5.C / 5.D)

- [x] **5.A** Spike `wavefile` × `bun --compile` × round-trip bit-exact sur Teensy + AudioMoth réels. `.gitattributes` LFS pour `test-data/`. Lib `src/lib/audio/` (`splitWavFile` générateur sync, `processWavFiles` orchestrateur), extraction `src/lib/fs/safeFsOps.ts` (`renameWithFallback` + `writeFileAtomic` EXDEV-safe). Allowlist `audioFormat ∈ {1, 0xFFFE}`, hard cap 500 MB, filtre `_NNN.wav$`, pre-clean orphan `.tmp`.
- [x] **5.B** Screens `vigie-process/` : Constat (perms + `processed/` existant en jaune + `statfs` espace disque), Form (sélecteur Teensy/Autre inline), Confirm (preview durée + rappel non-destructif), Result (4 variantes : success / interrupted / all-failed / partial avec groupage erreurs).
- [x] **5.C** Logging : `SessionEvent` discriminé sur `schema_version` (v1 = vigie-prefix byte-stable, v2 = vigie-process). Snapshot test assert l'immuabilité de la sérialisation v1. E2E test du flow process complet.
- [x] **5.D** Docs sync + workflow CI `ci.yml` (lint + typecheck + test + smoke build) en plus de `release.yml`.
- [x] **5.E** Progression intra-batch du flow Découper : `ProgressEvent` (file-start/chunk-written/file-done), `etaTracker` byte-weighted (`src/lib/audio/etaTracker.ts`), hook `useProgressState` colocalisé (`src/screens/vigie-process/useProgressState.ts`) avec throttle 100 ms + `finalizeRender()` synchrone, composant `RunningView` (chemin + fichier courant + barre 40 chars `█░` + ligne stats + adaptive masking < 5 fichiers + réassurance non-destructive en `dimColor`).

### Critère de sortie

- [x] `pnpm check` vert, 267+ tests (unit + integration sur fichiers réels Teensy/AudioMoth via git-lfs).
- [x] Spike validé : round-trip bit-exact sur fichiers réels + `bun --compile` clean (27 modules, 0 warning).
- [ ] Test manuel : dossier Teensy → mode `preserve` → chunks à 38 400 Hz dans `processed/`.
- [ ] Test manuel : dossier AudioMoth → mode `expand-10x` → chunks à 25 000 Hz, durée 50 s expansée (5 s réel — critère réécrit par la Phase 7).
- [ ] Test manuel : `processed/` existant → warning jaune ⚠ avec « renommer l'ancien dossier ».
- [ ] Test manuel : Ctrl+C pendant un gros fichier → aucun `.tmp` orphelin, `interrupted: true` loggé.
- [ ] Test manuel : batch nominal de 100 AudioMoth → ETA `Calcul du temps restant…` au 1ᵉʳ fichier, ETA convergé ±10 % dès le 2ᵉ, barre fluide visible toutes les ~10 s, barre à 100 % avant le ResultScreen.

### Hard guardrails de scope (à ne JAMAIS franchir)

> **In scope** : tout ce que la cible doit faire entre la sortie Teensy/AudioMoth et l'upload Vigie-Chiro (rename, split + TE×10, peut-être un jour : check fichier corrompu, contrôle metadata Vigie-Chiro).
>
> **Out of scope** : spectrogramme, lecteur audio, classification, ID auto, anything Tadarida does, anything Kaleidoscope analysis-side does.

## Phase 6 — Performance pipeline (worker pool + fast-path sox) ✓

**Objectif** : le découpage est CPU-bound (`wavefile.toBuffer()` ré-encode header + samples par chunk). Sur le dataset réel de l'utilisatrice (9301 fichiers AudioMoth/Teensy déjà préfixés), le pipeline mono-thread de la Phase 5 prenait ~3h30 — inacceptable pour un usage nuit après nuit. Phase 6 livre deux optimisations cumulables, détaillées dans `docs/architecture.md` § « Performance pipeline ».

### Tâches

- **Pipeline A — worker pool wavefile** (`src/lib/audio/splitWorkerPool.ts`) : N workers `node:worker_threads` calculés dynamiquement depuis la RAM et le nombre de cores (`Math.max(2, Math.min(RAM-based, cpuCount - 1, 12))`), surchargeable via `CHIRO_WORKER_COUNT`. Toujours actif. Gain attendu 3–6× selon la machine (non mesuré sur le dataset réel). Abort propre (attente des `{kind:"aborted"}` avec timeout, puis `terminate()` forcé) + pre-clean des `.tmp` orphelins au démarrage de chaque run.
- **Pipeline B — fast-path sox** (`src/lib/audio/soxFastPath.ts`) : opt-in si `sox` est détecté au boot (`detectSox`, désactivable via `CHIRO_DISABLE_FASTPATH=1`). Gain validé en PoC : ~22× wall sur AudioMoth (1802/1802 chunks bit-exact). ffmpeg a été testé et définitivement écarté (`-f segment -c copy` ne peut pas aligner les frontières de chunk au sample près sur du stream-copy PCM — 0/1802 MATCH sur le même PoC).
- **Header canonique unique A/B** (`src/lib/audio/wavHeader.ts`, `rewriteHeaderToStandardPcm`) : les deux pipelines produisent des fichiers bit-identiques, validé par un golden test SHA256 (`__tests__/golden.test.ts`).
- **Politique fallback per-batch first-error** : si sox crashe ou si le spot-check stratifié (3 chunks du 1er fichier : premier, milieu, dernier, comparés à la référence produite par le pipeline wavefile (A-vs-B, 100 samples au milieu de chaque chunk)) échoue, **tout le batch** retraite via le worker pool — jamais de mix de pipelines au sein d'un batch. Le pipeline réellement utilisé et le nombre de fallbacks sont tracés dans `~/.chiro/sessions.jsonl` (`engine`, `engine_fallback_count`).
- Asset embedding du worker pour `bun --compile` : `splitWorker.ts` est pré-bundlé (`pnpm build:worker`) en `.mjs` importé via `with { type: "file" }` pour survivre à la compilation en binaire (cf. `resolveWorkerPath()`).

### Critère de sortie

- [x] `pnpm check` vert.
- [x] Golden test SHA256 : pipelines A et B produisent des chunks bit-identiques.
- [x] Gain sox validé en PoC (~22× wall, 1802/1802 chunks bit-exact — `scripts/poc-*.ts`) ; worker pool : 3–6× attendu, non mesuré sur le dataset réel.
- [ ] Test manuel : run complet sur le dataset réel de l'utilisatrice, comparaison du temps total avant/après.

## Phase 7 — Découpage 50 s output et métadonnées GUANO/wamd (convention Kaleidoscope) ✓

**Objectif** : corriger un bug de la Phase 5 — le découpage coupait à 5 s sur la timeline de **sortie**, alors que la convention Kaleidoscope (Teensy natif TE×10, AudioMoth réécrit ×10) veut que le « Split to max duration = 5 s » du protocole Vigie-Chiro Point Fixe soit mesuré en **temps réel**, soit 50 s sur la timeline de sortie. Avant cette phase, les chunks produits par chiro étaient 10× trop courts en temps réel et Chirosuf affichait les chunks comme « compactés au début ». Phase 7 corrige ce calcul et ajoute les métadonnées ancillaires attendues par la chaîne Vigie-Chiro/Kaleidoscope.

### Tâches

- **Constantes centralisées** (`src/lib/audio/constants.ts`) : `CHUNK_OUTPUT_SECONDS = 50`, `CHUNK_REAL_SECONDS = 5`, `TIME_EXPANSION_FACTOR = 10`. Les deux pipelines (worker pool et sox) et l'estimation de progression (`estimateChunks.ts`) consomment ces constantes — plus de valeur `5` en dur pour la durée de coupe.
- **Métadonnées GUANO + wamd** (`src/lib/audio/finalizeChunk.ts`, `src/lib/audio/metadata/`) : après le split, chaque chunk reçoit un chunk RIFF ancillaire `guan` (GUANO 1.0) et `wamd` (Wildlife Acoustics), appendés après la zone `data` avec padding 2-byte et recalcul de la `RIFF size`. Les deux pipelines (A et B) produisent des sorties byte-identiques, vérifié manuellement sur `test-data/real_process_teensy/`.
- **Timestamp source** (`src/lib/files/parseTimestamp.ts`) : parsing du nom de fichier Teensy/AudioMoth (`_YYYYMMDD_HHMMSS`), ancré pour ne jamais matcher l'année du préfixe Vigie-Chiro (`Car340581-2026-…`). Si non parsable, le champ `Timestamp` est omis plutôt qu'écrit comme `Invalid Date`.
- **Kill-switch** `CHIRO_DISABLE_METADATA=1` : désactive entièrement l'ajout des chunks ancillaires (utile si un outil aval rejette un wamd inattendu, sans rebuild). État tracé dans `SessionEvent.result.metadata: "full" | "off"`.

### Critère de sortie

- [x] `pnpm check` vert.
- [x] `CHUNK_OUTPUT_SECONDS = 50` appliqué de bout en bout (les deux pipelines + l'estimation de progression).
- [x] Sorties byte-identiques worker pool / sox pour les métadonnées, vérifié manuellement sur données réelles.
- [ ] Test manuel : ouvrir un chunk produit dans Kaleidoscope/Chirosuf, vérifier que la durée et les métadonnées GUANO/wamd sont lues correctement (pas de chunks « compactés au début »).

## Passe de durcissement post-audit (août 2026) ✓

**Objectif** : un audit du code a mis en lumière des angles morts de résilience dans le pipeline de performance (Phase 6). Cette passe corrige la robustesse sans changer le comportement nominal, et ajoute un `--self-test` binaire pour prouver que le binaire compilé fonctionne réellement (au-delà des smoke tests `--version`/`--help`).

### Tâches

- [x] Détection worker mort (`node:worker_threads` `"error"` + `"exit"`) dans `splitWorkerPool.ts`, pour ne plus jamais laisser un batch pendre indéfiniment si un worker crashe sans message.
- [x] No-throw de bout en bout côté sox (`soxFastPath.ts`, `processOneFile`) avec cleanup per-fichier garanti (`cleanPartialOutput`).
- [x] Nouveaux écrans / mappings d'erreur pour les cas de run-error côté `vigie-process`.
- [x] `--self-test` (`src/lib/selftest/selfTest.ts`) : exercice du binaire compilé de bout en bout — résolution de l'asset worker en `/$bunfs/`, un vrai split, et (si sox est installé) la garantie de byte-identité sox↔pool. Intégré à `ci.yml` (`smoke-build`) et `release.yml`.

### Critère de sortie

- [x] `pnpm check` vert ; `--self-test` passe sur les deux binaires compilés en CI (avec et sans sox).

Détails d'implémentation complets dans `CLAUDE.md` (« Pièges connus », § worker pool) et `docs/architecture.md` § « Safety nets ».

## Phase 8 — Créer un zip des enregistrements découpés ✓

**Objectif** : fermer la boucle du protocole. Une fois le découpage fait, l'utilisatrice doit déposer ses fichiers sur Vigie-Chiro — ce qui suppose de zipper `processed/` à la main dans le Finder, sur des dossiers de milliers de fichiers et des dizaines de Go. Phase 8 internalise cette étape : `processed/` → `archived/processed_YYYYMMDDHHMM.zip`, **non-destructif**. Détails complets dans `docs/architecture.md` § « Module `lib/archive` ».

### Tâches (réalisées en 8.A / 8.B / 8.C / 8.D)

- **Writer ZIP maison** (`src/lib/archive/`) : `crc32.ts`, builders binaires purs (`zipFormat.ts`), plan et nommage (`planArchive.ts`), orchestration streaming (`createZipArchive.ts`), vérification post-écriture (`verifyZipArchive.ts`). Zéro dépendance ajoutée — ADR dans `architecture.md` (npm type yazl, `spawn zip` et tar/tar.gz écartés, ce dernier parce que le format zip est imposé par le portail).
- **Deflate niveau 6** via `node:zlib` plutôt que `stored` : mesuré ≈ 36 % de la taille source sur du contenu Teensy réel, ≈ 28 Mio/s bout en bout. L'usage étant le dépôt en ligne, compresser fait gagner du temps d'upload.
- **ZIP64 conditionnel** (central directory + EOCD seulement, jamais les local headers ; saturation par champ) avec **seuils injectables**, ce qui permet d'exercer tout le chemin en CI sans fixture de 4 Go.
- **Vérification avant publication** : complétude contre le plan (égalité d'ensembles), structure (dont relecture des octets patchés de chaque local header et contiguïté), CRC en mode `spot`. Ordre `sync()` → verify → `close()` → `rename` — `ENOSPC` se manifeste au fsync, pas au write.
- **3 écrans** (`src/screens/archive/`) sans écran de saisie, progression pilotée par les octets lus en source + ETA byte-weighted réutilisé du flow Découper. Ctrl+C câblé localement pendant le run.
- **Extractions à leur 2ᵉ usage** : `src/lib/format/{bytes,progress}.ts`, `isVisibleNonTmpEntry` partagé entre le flow Découper et le flow zip, `src/screens/fsErrorMessages.ts` (règle de trois atteinte).
- **`SessionEvent` v3** (`action: "vigie-archive"`, sans `input`, `result` discriminé sur `status`) + frontière eslint pour le 3ᵉ flow d'écrans.

### Critère de sortie

- [x] `pnpm check` vert.
- [x] Archives validées par trois extracteurs indépendants (`unzip -t`, `python3 -m zipfile -t`, `bsdtar -tf`) — échec dur si un outil manque en CI.
- [x] Chemin ZIP64 couvert de bout en bout en CI via des seuils injectés.
- [x] Non-destructivité : `processed/` intact après succès, abort et échec ; aucun zip partiel dans `archived/` dans les trois cas.
- [ ] Test manuel : parcours complet dans un dossier réel, zip ouvert avec Archive Utility, dépôt accepté par Vigie-Chiro comme un zip manuel.
- [ ] Test manuel : run sur un dossier > 4 Gio (confirmation du chemin ZIP64 déjà couvert en CI).

## V2 (post-MVP, hors scope)

Idées priorisées par valeur utilisateur :

1. **Pré-remplissage de la dernière session** (`~/.config/chiro/last-session.json`). Énorme gain UX pour utilisation nuit après nuit. Estimation : 2 h.
2. **Annuler la dernière opération** (journal `.chiro-undo.json` posé dans le dossier au moment du rename). Rassurance maximale. Estimation : 4 h.
3. **Lecture des métadonnées WAV** (date d'enregistrement, GPS si SM4+) pour auto-suggérer l'année et alerter en cas d'incohérence. Estimation : 1 j.
4. **Mode batch CLI** pour utilisateurs avancés : `chiro vigie --carre 040962 --pass 3 --point A1`. Estimation : 0.5 j.
5. **Brew tap perso** (`homebrew-chiro`) — formula pointant sur les GH Releases existantes. Estimation : 1 h.
6. **Linux arm64**, **macOS Intel x64**. Estimation : 1 h (juste 2 targets de build à ajouter).
7. **Internationalisation** (EN) si l'usage déborde le réseau Vigie-Chiro français.

### Follow-ups Phase 8 (zip) — différés

14. **Upload direct vers Glacier Scaleway** depuis chiro, une fois le zip créé et vérifié : l'archivage long terme des enregistrements bruts est aujourd'hui manuel. Suppose de gérer des credentials (à ne pas stocker en clair), l'upload multipart d'un objet de 10–20 Go et la reprise sur coupure réseau. Estimation : 2 j.
15. **Suppression de `processed/` après zip vérifié** — le vrai gain d'espace disque pour l'utilisatrice. Trois préconditions, non négociables : (1) `verifyZipArchive` appelé en **`crcMode: "full"`** et non `"spot"` (un mot à changer, le mode existe déjà) ; (2) **`fsync` du répertoire `archived/`** après le rename, sinon on supprime les sources en se fiant à une entrée de répertoire non durable ; (3) écran de confirmation explicite, distinct du flow non-destructif actuel — la réassurance « rien n'est supprimé » disparaît, tout le wording est à revoir. Estimation : 1 j.

### Follow-ups Phase 5 (split / TE) — différés

8. **Option « split-channels » pour détecteurs stéréo** (SM2BAT+, SM4BAT) — alignée sur la case « Split channels » de Kaleidoscope. Aujourd'hui les canaux restent groupés ; un user avec stéréo devrait choisir explicitement de séparer (ou pas). Estimation : 2 h (passe `slices.map` en `slices.forEach` + boucle par canal).
9. **Streaming pour fichiers > 500 MB** : `wavefile` charge tout en RAM. Pour passer les très gros fichiers, écrire un parseur RIFF streaming (~150 lignes). Estimation : 1 j.
10. **Durée de découpe paramétrable** (UI) : aujourd'hui 50 s output / 5 s réel, figé. Devrait être un champ optionnel du FormScreen pour les protocoles autres que Point Fixe (5 s pour Routier, par ex.). Estimation : 1 h.
11. **Modes TE additionnels** : actuellement `preserve` (Teensy) et `expand-10x` (Autre). Si un détecteur émerge avec TE ×8 ou ×20, ajouter au type `TimeExpansionMode` + un sélecteur plus riche. Estimation : 30 min par mode.
12. **Mode batch automatique** : détection auto Teensy vs AudioMoth via header `fmt.sampleRate` (38 400 → preserve, > 100 000 → expand-10x). Évite l'étape Form, à risque modéré. Estimation : 2 h.
13. **Conservation du chunk `LIST/INFO`** (metadata AudioMoth « Recorded at … by AudioMoth … ») — aujourd'hui droppé par `wavefile.fromScratch`, cohérent avec Kaleidoscope. Si Tadarida en a besoin, écrire un patcheur post-encode qui réinjecte le LIST. Estimation : 4 h.

## Définition de "Terminé"

Le MVP est livrable quand :

- Phases 0 à 4 ont leurs critères de sortie cochés.
- Le `README.md` racine permet à un naturaliste non-tech d'installer et d'utiliser l'outil sans intermédiaire technique.
- Le critère de succès du `vision.md` est tenu : **conjointe seule, < 2 min, sans peur**.
