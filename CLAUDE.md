# chiro-tools — guide pour Claude

Interactive CLI (Ink TUI) qui aide une utilisatrice non-tech à préfixer des enregistrements `.wav` au format Vigie-Chiro (sciences participatives chauve-souris). Cible : la conjointe du dev + ses collègues naturalistes. Critère de succès : "conjointe seule, < 2 min, sans peur".

La spec figée vit dans [`docs/`](./docs/) — `vision.md`, `spec.md`, `ux.md`, `architecture.md`, `roadmap.md`. **Toujours relire `docs/ux.md` avant de changer un wording UI** (les libellés sont calibrés à la virgule près pour la cible).

## Stack figée

- **Bun** runtime + `bun --compile` pour les binaires (macOS arm64 + Linux x64)
- **pnpm** 11 (lockfile committé) — Node 22.13+ requis pour `pnpm install`
- **TypeScript strict** (NodeNext, `noUncheckedIndexedAccess`, `target: ES2022`)
- **Ink 7** + **React 19** + `ink-text-input` (champs texte) + saisie maison (champs numériques)
- **vitest 4** + `ink-testing-library` (E2E TUI)
- **eslint** flat config (strictTypeChecked) + **prettier** + **husky** + lint-staged

Pas de zod, pas de tsup, pas de commander, pas de Sentry. Si tu es tenté d'en ajouter un, c'est probablement de l'over-engineering.

## Commands

```bash
pnpm dev                # bun src/index.tsx — lance la TUI dans cwd
pnpm dev:watch          # idem avec hot-reload
pnpm test               # vitest run
pnpm test:coverage      # idem + report v8
pnpm check              # lint + typecheck + format:check + test — à passer avant tout commit
pnpm build              # produit les 2 binaires (darwin-arm64 + linux-x64)
scripts/reset-demo.sh   # reset /tmp/chiro-demo à un dataset connu (10 .wav + 1 préfixé + 1 .txt + 1 .WAV)
```

Tester la TUI dans un dossier de demo :

```bash
scripts/reset-demo.sh
cd /tmp/chiro-demo && bun /Users/zaratan/Projects/chiro-tools/src/index.tsx
```

## Architecture — règles dures

| Couche            | Imports autorisés                               | Imports interdits       | Coverage    |
| ----------------- | ----------------------------------------------- | ----------------------- | ----------- |
| `src/lib/`        | `node:*`, autres modules de `lib/`              | `ink`, `react`, `ink-*` | viser 100%  |
| `src/screens/`    | `ink`, `react`, `components/`, `lib/`, `types/` | autre screen interne    | best-effort |
| `src/components/` | `ink`, `react`                                  | `lib/`, `screens/`      | best-effort |
| `src/types.ts`    | (aucun import — pure types)                     | tout                    | n/a         |

Les hooks `use*.ts` colocalisés dans `screens/<flow>/` sont la couche d'orchestration : cycle de vie du run, AbortController, `runningRef`, logging — zéro JSX, zéro métier (délégué à `lib/`). Pattern de référence : `useVigieProcessRun.ts`.

**Si une logique métier dépasse 5 lignes dans un screen, elle migre dans `lib/`.** C'est non-négociable. **Aucun `process.env` dans `screens/`** : tout kill-switch passe par une fonction `lib/` nommée (`metadataEnabled`, `detectSox`…) — pas de `lib/runtime/env.ts` centralisateur pour autant, une fonction par flag là où il est consommé.

Patterns à respecter (sinon code review rouge) :

- **No throw** sur les chemins normaux : retour `Result` tagué (`{ kind: "ok", ... } | { kind: "error", code }`). Cf. `src/lib/fs/applyRenames.ts`, `src/lib/update/fetchLatestVersion.ts`.
- **AbortSignal** propagé dans toute fonction async qui fait du I/O — cleanup via `controller.abort()` au démontage d'un composant.
- **`cancelled = false`** dans tout `useEffect` async pour éviter les `setState` post-unmount.
- **Écriture atomique** : `.tmp` puis `rename` pour tout fichier write (cache, log). Cf. `src/lib/update/cache.ts`.
- **Imports `.js`** (NodeNext) même pour des fichiers `.ts` : `import { foo } from "./bar.js"`.
- **`runningRef`** dans `app.tsx` consulté par le handler Ctrl+C global pour qu'un opération en cours (rename, fetch update) ne soit pas tuée à mi-chemin.

## Code style

- **Tout en anglais** dans le code : fonctions, types, variables, **commentaires**. Zéro franglais. Les strings UI restent **en français** (et uniquement là).
- **Default to no comments**. N'écrire un commentaire que si le _pourquoi_ n'est pas évident (workaround, invariant subtil, contrainte cachée). Ne jamais expliquer ce que le code fait.
- Pas de commentaires sur les changements en cours ("renamed from foo", "removed bar") — ça pourrit, c'est le boulot du commit.
- Pas d'`any`, pas de `!`, pas de `as unknown as ...` sauf si le typage est vraiment intractable.
- `strictNullChecks` + `noUncheckedIndexedAccess` → tester les accès `arr[i]` avant utilisation.

## Workflow attendu

1. **Toute tâche non-triviale** passe par le mode plan d'abord. Demander à `lead-engineer-reviewer` + `tech-architect` + `ui-ux-designer` (en parallèle) de relire le plan avant `ExitPlanMode`.
2. **Implémentation déléguée** au `clean-ts-developer` pour le gros du dev TS/Ink. Garde les modifs ciblées en main.
3. **Découpage en sous-phases** (A / B / C / D…). À la fin de chaque sous-phase, repasser la main pour test manuel.
4. **`pnpm check` doit être vert** avant de proposer la fin d'une sous-phase. Pas d'exception.
5. **Docs synchronisées** : toute modif de comportement → update `docs/ux.md` et/ou `docs/spec.md` et/ou `docs/architecture.md` dans la même sous-phase (sous-phase D dédiée).
6. **Review post-implé** : `lead-engineer-reviewer` toujours. `ui-ux-designer` si UI touchée. `tech-architect` si architecture touchée. En parallèle.

**Jamais de `git commit` / `git tag` / `git push` depuis l'agent.** L'utilisateur fait tous ses commits lui-même. Tu peux `git add` et proposer un message, c'est tout.

## Cible utilisatrice — rappels

- Naturaliste, **pas** dev. Lit un terminal pour la première fois.
- Recoit ses enregistrements d'un Teensy : `PaRec<serial>_YYYYMMDD_HHMMSS.wav` + un `LogPR*.txt` à ignorer.
- Format cible : `Car{6 chiffres}-{année}-Pass{N}-{point uppercase}-{original}.wav`.
- Wordings français bienveillants, jamais anxiogènes, jamais de jargon technique sans glossaire (cf. `docs/ux.md` table couleurs/codes).
- Le détail technique d'erreur va en bas (`dimColor`, "à transmettre si vous demandez de l'aide"). Pas en titre.

## Self-update (pattern à connaître)

`UpdateScreen` propose une install via `install.sh`. Pour spawner depuis Ink sans casser stdout :

1. `UpdateScreen.onRequestInstall()` appelle une callback remontée à `index.tsx` via `App.onRequestUpdate`.
2. La callback pose un drapeau local (`installAfterExit`), puis `useApp().exit()`.
3. Après `render().waitUntilExit()` dans `index.tsx`, si le drapeau est posé, on lance `spawnSync("bash", ["-c", "curl -fL ... | bash"], { stdio: "inherit" })` puis `process.exit(proc.status ?? ...)`.

Ne pas spawner pendant qu'Ink dessine — stdout serait contesté.

`INSTALL_SCRIPT_URL` est épinglé sur le tag de la version courante (`v${CHIRO_VERSION}`, pas `main`) depuis le Chantier D — le self-update utilise toujours LE script testé avec sa propre release. `FALLBACK_INSTALL_SCRIPT_URL` (même fichier) reste sur `main` et n'est utilisé que pour le message affiché si le script épinglé échoue (tag supprimé). Le `curl | bash` du README pour la première install pointe lui aussi `main`, indépendamment.

`install.sh` télécharge aussi `SHA256SUMS` (publié par `release.yml`) et vérifie la somme du tarball avant extraction — fail-open (warning, install continue) si le fichier est absent ou si aucun outil de hash n'est dispo, échec dur si mismatch.

Auto-check au boot : `App.useEffect` mount → `checkForUpdate` (cache disque 6 h à `~/.chiro/update-check.json`). Silent fail total au boot — pas d'erreur visible. Hint jaune dans le menu si une version est dispo.

`CHIRO_VERSION` est lu depuis `package.json` à la compilation. Le workflow `release.yml` **réécrit `package.json` au tag** (`${GITHUB_REF_NAME#v}`) avant le build, sinon le binaire ne reflète pas la version du release. Sanity check après build : `./dist/chiro-... --version` doit matcher le tag.

`--self-test` est un flag caché (absent de `--help`) qui exerce le binaire compilé au-delà de `--version` : résolution du worker bundlé dans `/$bunfs/` (`splitWorkerPool.ts:resolveWorkerPath`), rendu ink/yoga non-interactif, et un vrai batch de découpage sur une fixture WAV déterministe — avec le fast-path sox et sa garantie de byte-identité si `sox` est détecté. Logique dans `src/lib/selftest/selfTest.ts` (aucun import ink/react — frontière eslint respectée). Appelé par `ci.yml` (job `smoke-build`, sox installé) et `release.yml` (pas de sox sur ces runners → pool seul).

## Tests manuels TUI

`ink-testing-library` ne couvre que le parcours nominal. Pour les flux interactifs complexes (rename, update, Ctrl+C), tester à la main dans `/tmp/chiro-demo`. Ne JAMAIS prétendre qu'une UI marche sans l'avoir vue tourner — dire explicitement "non testé manuellement" si c'est le cas.

## Performance pipeline (Phase 6) — résumé exécutif

Le découpage WAV est CPU-bound (`wavefile.toBuffer()` ré-encode header + samples par chunk). Deux pipelines livrés, **détails complets dans `docs/architecture.md` § « Performance pipeline »** :

- **A : worker pool wavefile** (`splitWorkerPool.ts`) — toujours actif. N workers `node:worker_threads` calculé dynamiquement depuis RAM + CPU. Surchargeable via `CHIRO_WORKER_COUNT`. Gain 3–6×.
- **B : fast-path sox** (`soxFastPath.ts`) — opt-in si `sox` détecté au boot (`detectSox`). Gain ~22× wall. Désactivable via `CHIRO_DISABLE_FASTPATH=1`.
- **Header canonique unique** : `rewriteHeaderToStandardPcm` (`wavHeader.ts`) appliqué dans les **deux** pipelines après le split. Un seul format de sortie, un seul golden test (`__tests__/golden.test.ts`).
- **Politique fallback per-batch first-error** : si sox crashe ou si spot-check stratifié (3 chunks : 1er + milieu + dernier) échoue sur le 1er fichier, **tout le batch** retraite via worker pool. Pas de mix de pipelines au sein d'un batch.
- **Moteur silencieux dans la TUI** (cf. `docs/ux.md` § Choix UX validés). Pipeline utilisé tracé uniquement dans `~/.chiro/sessions.jsonl` (`engine`, `engine_fallback_count`).

## Découpage et métadonnées — convention Kaleidoscope (Phase 7)

- **5 s temps réel = 50 s timeline output**. Les constantes vivent dans `src/lib/audio/constants.ts` (`CHUNK_OUTPUT_SECONDS = 50`, `CHUNK_REAL_SECONDS = 5`). Teensy enregistre nativement en TE×10, AudioMoth est réécrit ×10 par chiro — donc dans les deux modes la sortie est TE×10 et on coupe à 50 s d'audio expansé = 5 s réel. Avant la Phase 7, chiro coupait à 5 s output (10× trop court en temps réel) et Chirosuf affichait les chunks "compactés au début".
- **GUANO + wamd ancillaires** appendés après le `data` chunk via `src/lib/audio/finalizeChunk.ts` (wrapper de `rewriteHeaderToStandardPcm` + `appendAncillaryChunks`). Builders dans `src/lib/audio/metadata/`. Worker pool et sox partagent les mêmes builders → outputs byte-identiques (vérifié manuellement sur `test-data/real_process_teensy/`).
- **Kill-switch** `CHIRO_DISABLE_METADATA=1` : désactive entièrement l'append (utile si Chirosuf râle sur un format wamd inattendu, sans rebuild). Tracé dans `sessions.jsonl` (`metadata: "full" | "off"`).
- **Timestamp parsing** : `src/lib/files/parseTimestamp.ts`. Regex ancré sur `_YYYYMMDD_HHMMSS` pour éviter de matcher l'année du préfixe Vigie-Chiro (`Car340581-2026-`). Si non parsable → `Timestamp` omis du GUANO/wamd plutôt qu'écrit comme `Invalid Date`.

## Archive zip (Phase 8) — pièges à connaître

Writer ZIP maison dans `src/lib/archive/` (zéro dépendance, ADR + détails complets dans `docs/architecture.md` § « Module `lib/archive` »). Zippe `processed/` vers `archived/processed_YYYYMMDDHHMM.zip` en **deflate niveau 6** (mesuré ≈ 36 % de la taille source sur du Teensy réel — l'usage est le dépôt en ligne, compresser paie). Non-destructif : aucun `unlink`/`write` sur un chemin sous `processed/`, invariant structurel du module.

- **Un seul `FileHandle` ouvert en `"w"`, jamais `"a"`** : le CRC et les tailles sont patchés après coup par un pwrite de 12 octets à `localHeaderOffset + 14`, et `O_APPEND` fait ignorer le paramètre `position`. Pas de `createWriteStream` ni de `pipeline()` non plus — buffering + pwrite = corruption non déterministe.
- **Ordre de finalisation `sync()` → verify → `close()` → `rename`**, jamais autrement : `ENOSPC` se manifeste au fsync (delayed allocation), et vérifier avant le `sync()` validerait le page cache. Tout échec unlink le `.tmp` → aucun zip partiel n'existe jamais, c'est ce que promet le wording d'erreur.
- **Longueur des noms = `Buffer.from(name, "utf8").length`**, jamais `String.length` : un seul accent et l'archive est illisible. Date DOS clampée `[1980, 2107]` + fallback `NaN` (sinon `writeUInt16LE` throw = contrat no-throw violé).
- **ZIP64 = chemin nominal** (zips de 10–20 Go), mais uniquement dans le central directory et l'EOCD, jamais dans les local headers ; saturation **par champ**. Seuils injectables (`zip64Thresholds`) pour tester en CI sans fixture de 4 Go.
- **`--self-test` n'est volontairement pas étendu au zip** (ni asset bundlé ni worker → aucun piège de `bun --compile` à couvrir). Ne pas le « compléter » par réflexe de symétrie.
- **Dettes assumées, documentées** : symlinks dans `processed/` silencieusement exclus (`isFile()`) ; deux instances de chiro dans le même cwd à la même minute → le rename final peut écraser ; pas de `fsync` du répertoire `archived/` — c'est une **précondition** de la future suppression de `processed/`, au même titre que `crcMode: "full"`.
- **Vocabulaire** : « morceaux » est banni de toute l'app au profit d'« enregistrements » (et « fichiers » pour les sorties du découpage). Règle dans `docs/ux.md`.

## Pièges connus

- **APFS case-insensitive** : `foo.wav` et `FOO.WAV` collisionnent sur macOS. `planRenames` pré-vérifie via `fs.access` avant chaque rename.
- **`ink-text-input` consomme `←`/`→`** pour son curseur. Les champs numériques de `FormScreen` utilisent le mode `managed` (Text brut + handlers maison) pour éviter le conflit avec l'ajustement de valeur.
- **`react-devtools-core` doit être en `devDep`** même si jamais importé explicitement — Ink l'importe statiquement et `bun --compile` ferait faillir sans.
- **pnpm 11 nécessite Node ≥ 22.13** (utilise `node:sqlite`). Le runner CI doit avoir setup-node avant pnpm/action-setup.
- **bun est pinné en CI** (`bun-version:` dans `ci.yml` + `release.yml`) car il est compilé _dans_ le binaire livré. Dependabot ne bump pas les inputs d'actions : relever le pin manuellement en même temps que le bun local (`bun --version`). Au bump, re-vérifier une fois que le binaire linux tourne sur la glibc plancher visée (`docker run --rm -v "$PWD/dist:/w:ro" ubuntu:20.04 /w/chiro-linux-x64 --self-test` depuis une machine amd64 — le plancher glibc et l'exigence AVX viennent du runtime bun précompilé, pas de notre code, donc inutile de le tester à chaque push).
- **`wavefile` quirks** (résumé — détails complets dans `docs/architecture.md` § « Quirks wavefile ») : `getSamples(false, IntXXArray)` renvoie un flat IntXXArray pour mono / un IntXXArray[] pour multichannel (normaliser systématiquement). `bitDepth` est une **string**. Les chunks `LIST/INFO/ICMT` (metadata AudioMoth) sont droppés au re-encode — aligné Kaleidoscope.
- **`tseslint` ne narrow pas `signal?.aborted` à travers un `yield`** : utiliser un helper local `const isAborted = (): boolean => opts.signal?.aborted === true;` pour les checks fréquents dans un générateur.
- **`scripts/` est out-of-tsconfig**, donc out-of-eslint. Le dossier est dans `ignores` du `eslint.config.js`. Bun les exécute sans typecheck — assume that scripts may be loosely typed.
- **`bun --compile` + worker bundles** : un fichier worker `.mjs` référencé via `import.meta.url` n'est **pas** embarqué automatiquement dans le binary. Pattern obligatoire : `import asset from "./worker.bundled.mjs" with { type: "file" }`. Vitest n'honore pas l'assertion → fallback `fileURLToPath` via narrow runtime. Le worker source TS est pré-bundlé via `pnpm build:worker` (chaîné explicitement en `&&` dans les scripts dev/test/build/check — pas de hooks `pre*`). Bundle gitignored, ambient declaration dans `src/types/asset-imports.d.ts`. Cf. `splitWorkerPool.ts:resolveWorkerPath()`.
- **ffmpeg rejeté pour le découpage** : le muxer `segment -c copy` aligne sur des packet boundaries internes (~131072 samples) au lieu du sample exact demandé. Pas d'output bit-exact possible sur stream-copy PCM. Validé empiriquement par le PoC `scripts/poc-*.ts` : 0/1802 MATCH. Sox bit-exact à 1802/1802 → retenu. Si futur use case ffmpeg, repartir du PoC pour re-valider.
