# chiro-tools — guide pour Claude

Interactive CLI (Ink TUI) qui aide une utilisatrice non-tech à préfixer des enregistrements `.wav` au format Vigie-Chiro (sciences participatives chauve-souris). Cible : la conjointe du dev + ses collègues naturalistes. Critère de succès : "conjointe seule, < 2 min, sans peur".

La spec figée vit dans [`docs/`](./docs/) — `vision.md`, `spec.md`, `ux.md`, `architecture.md`, `roadmap.md`. **Toujours relire `docs/ux.md` avant de changer un wording UI** (les libellés sont calibrés à la virgule près pour la cible).

## Stack figée

- **Bun** runtime + `bun --compile` pour les binaires (macOS arm64 + Linux x64)
- **pnpm** 11 (lockfile committé) — Node 22.13+ requis pour `pnpm install`
- **TypeScript strict** (NodeNext, `noUncheckedIndexedAccess`, `target: ES2022`)
- **Ink 6** + **React 19** + `ink-text-input` (champs texte) + saisie maison (champs numériques)
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

**Si une logique métier dépasse 5 lignes dans un screen, elle migre dans `lib/`.** C'est non-négociable.

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

Auto-check au boot : `App.useEffect` mount → `checkForUpdate` (cache disque 6 h à `~/.chiro/update-check.json`). Silent fail total au boot — pas d'erreur visible. Hint jaune dans le menu si une version est dispo.

`CHIRO_VERSION` est lu depuis `package.json` à la compilation. Le workflow `release.yml` **réécrit `package.json` au tag** (`${GITHUB_REF_NAME#v}`) avant le build, sinon le binaire ne reflète pas la version du release. Sanity check après build : `./dist/chiro-... --version` doit matcher le tag.

## Tests manuels TUI

`ink-testing-library` ne couvre que le parcours nominal. Pour les flux interactifs complexes (rename, update, Ctrl+C), tester à la main dans `/tmp/chiro-demo`. Ne JAMAIS prétendre qu'une UI marche sans l'avoir vue tourner — dire explicitement "non testé manuellement" si c'est le cas.

## Performance pipeline (Phase 6) — résumé exécutif

Le découpage WAV est CPU-bound (`wavefile.toBuffer()` ré-encode header + samples par chunk). Deux pipelines livrés, **détails complets dans `docs/architecture.md` § « Performance pipeline »** :

- **A : worker pool wavefile** (`splitWorkerPool.ts`) — toujours actif. N workers `node:worker_threads` calculé dynamiquement depuis RAM + CPU. Surchargeable via `CHIRO_WORKER_COUNT`. Gain 3–6×.
- **B : fast-path sox** (`soxFastPath.ts`) — opt-in si `sox` détecté au boot (`detectSox`). Gain ~22× wall. Désactivable via `CHIRO_DISABLE_FASTPATH=1`.
- **Header canonique unique** : `rewriteHeaderToStandardPcm` (`wavHeader.ts`) appliqué dans les **deux** pipelines après le split. Un seul format de sortie, un seul golden test (`__tests__/golden.test.ts`).
- **Politique fallback per-batch first-error** : si sox crashe ou si spot-check stratifié (3 chunks : 1er + milieu + dernier) échoue sur le 1er fichier, **tout le batch** retraite via worker pool. Pas de mix de pipelines au sein d'un batch.
- **Moteur silencieux dans la TUI** (cf. `docs/ux.md` § Choix UX validés). Pipeline utilisé tracé uniquement dans `~/.chiro/sessions.jsonl` (`engine`, `engine_fallback_count`).

## Pièges connus

- **APFS case-insensitive** : `foo.wav` et `FOO.WAV` collisionnent sur macOS. `planRenames` pré-vérifie via `fs.access` avant chaque rename.
- **`ink-text-input` consomme `←`/`→`** pour son curseur. Les champs numériques de `FormScreen` utilisent le mode `managed` (Text brut + handlers maison) pour éviter le conflit avec l'ajustement de valeur.
- **`react-devtools-core` doit être en `devDep`** même si jamais importé explicitement — Ink l'importe statiquement et `bun --compile` ferait faillir sans.
- **pnpm 11 nécessite Node ≥ 22.13** (utilise `node:sqlite`). Le runner CI doit avoir setup-node avant pnpm/action-setup.
- **`wavefile` quirks** (résumé — détails complets dans `docs/architecture.md` § « Quirks wavefile ») : `getSamples(false, IntXXArray)` renvoie un flat IntXXArray pour mono / un IntXXArray[] pour multichannel (normaliser systématiquement). `bitDepth` est une **string**. Les chunks `LIST/INFO/ICMT` (metadata AudioMoth) sont droppés au re-encode — aligné Kaleidoscope.
- **`tseslint` ne narrow pas `signal?.aborted` à travers un `yield`** : utiliser un helper local `const isAborted = (): boolean => opts.signal?.aborted === true;` pour les checks fréquents dans un générateur.
- **`scripts/` est out-of-tsconfig**, donc out-of-eslint. Le dossier est dans `ignores` du `eslint.config.js`. Bun les exécute sans typecheck — assume that scripts may be loosely typed.
- **`bun --compile` + worker bundles** : un fichier worker `.mjs` référencé via `import.meta.url` n'est **pas** embarqué automatiquement dans le binary. Pattern obligatoire : `import asset from "./worker.bundled.mjs" with { type: "file" }`. Vitest n'honore pas l'assertion → fallback `fileURLToPath` via narrow runtime. Le worker source TS est pré-bundlé via `pnpm build:worker` (hooked `predev`/`pretest`/`prebuild`/`precheck`). Bundle gitignored, ambient declaration dans `src/types/asset-imports.d.ts`. Cf. `splitWorkerPool.ts:resolveWorkerPath()`.
- **ffmpeg rejeté pour le découpage** : le muxer `segment -c copy` aligne sur des packet boundaries internes (~131072 samples) au lieu du sample exact demandé. Pas d'output bit-exact possible sur stream-copy PCM. Validé empiriquement par le PoC `scripts/poc-*.ts` : 0/1802 MATCH. Sox bit-exact à 1802/1802 → retenu. Si futur use case ffmpeg, repartir du PoC pour re-valider.
