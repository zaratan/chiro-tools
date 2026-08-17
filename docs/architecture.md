# Architecture technique

## Stack

| Domaine            | Choix                                                                             | Notes                                                                                                                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package manager    | **pnpm** 11 (`packageManager` pin `pnpm@11.21.0`)                                 | Aligné sur les autres projets de l'auteur (cf. `~/Projects/arkham-proba`). pnpm 11 requiert Node ≥ 22.13 (`node:sqlite`).                                                                                                                               |
| Runtime dev + exec | **Bun** (dernière stable)                                                         | Bun lance le TS directement, sert de bundler/compileur pour le binaire.                                                                                                                                                                                 |
| Langage            | **TypeScript strict**                                                             | `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `skipLibCheck: true`.                                                                                                                                               |
| UI CLI             | **Ink 7** + **React 19**                                                          | TUI déclarative.                                                                                                                                                                                                                                        |
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

Conséquence : Teensy enregistre **déjà** en TE×10 au record-time (38 400 Hz « audible » représentant un réel 384 000 Hz) — on ne touche pas au sample rate. AudioMoth enregistre full-spectrum à 250 000 Hz — on réécrit `fmt.sampleRate ← 25 000` (lossless, header-only). Dans les deux cas, on découpe en chunks de **50 s mesurés sur la timeline de sortie** — soit 5 s de temps réel une fois la TE×10 prise en compte (`CHUNK_OUTPUT_SECONDS = 50`, `CHUNK_REAL_SECONDS = 5` dans `src/lib/audio/constants.ts`). Avant la Phase 7, chiro coupait à 5 s de sortie (10× trop court en temps réel) ; corrigé depuis — cf. § Performance pipeline / Métadonnées GUANO + wamd plus bas.

## Structure du repo

```
chiro-tools/
├── .github/
│   ├── dependabot.yml            # actions (mensuel) + npm (hebdo, groupé)
│   └── workflows/
│       ├── ci.yml                # push + PR : job check (matrix Linux×2 sox + macOS) + smoke-build (--version/--help/--self-test)
│       └── release.yml           # tag v*.*.* : pnpm check + build + ad-hoc codesign macOS + GH Release
├── .husky/
│   └── pre-commit                # lint-staged
├── docs/                         # CE DOSSIER — spec figée
├── scripts/
│   ├── install.sh                # téléchargement du bon binaire (tarball) depuis GH Releases
│   ├── reset-demo.sh             # reset /tmp/chiro-demo à un dataset connu
│   ├── generate-demo-fixtures.ts
│   ├── trim-audiomoth-fixtures.ts
│   └── poc-*.ts                  # PoC historiques sox/ffmpeg (cf. § Pourquoi sox et pas ffmpeg) — hors tsconfig/eslint
├── test-data/                    # fixtures réelles Teensy/AudioMoth, versionnées en git-lfs
├── src/
│   ├── index.tsx                 # entry point — boot (TTY check, --version/--help/--self-test) puis render <App />, post-Ink spawn install.sh si drapeau update
│   ├── app.tsx                   # routeur d'écrans (state machine) + auto-check boot via checkForUpdate
│   ├── version.ts                # CHIRO_VERSION lu depuis package.json (Bun inline à la compile)
│   ├── types.ts                  # types partagés (FormInput, RenamePlan, ProcessInput, SessionEvent, …)
│   ├── types/
│   │   └── asset-imports.d.ts    # ambient declare module "*.bundled.mjs" pour l'asset worker
│   ├── screens/
│   │   ├── MenuScreen.tsx
│   │   ├── UpdateScreen.tsx       # 4 états : checking / available / up-to-date / error
│   │   ├── updateErrorMessages.ts # mapping FR pour les codes d'erreur Update
│   │   ├── fsErrorMessages.ts     # codes fs communs (ENOSPC/EACCES/EPERM/EROFS) → FR, partagé par les 3 flows
│   │   ├── vigie-chiro/           # flow "Préfixer" — 4 écrans
│   │   │   ├── ConstatScreen.tsx  # constat — scan racine + Brut(s)/ via lib/fs/scanDirectory, écran duplicate-names dédié
│   │   │   ├── FormScreen.tsx     # focusedIndex + 4 <TextField> (numeric en mode managed)
│   │   │   ├── ConfirmScreen.tsx
│   │   │   ├── ResultScreen.tsx
│   │   │   └── errorMessages.ts   # mapping FR pour codes d'erreur rename
│   │   ├── vigie-process/         # flow "Découper" — 4 écrans (Phase 5) + progression (Phase 5.E)
│   │       ├── ConstatScreen.tsx  # constat — scan racine + Brut(s)/ via lib/fs/scanDirectory + checks processed/ et espace disque
│   │       ├── FormScreen.tsx     # sélecteur Teensy/Autre inline (pas de RadioSelect)
│   │       ├── ConfirmScreen.tsx  # affichage + navigation seulement — l'orchestration vit dans useVigieProcessRun
│   │       ├── ResultScreen.tsx   # 4 variantes : success / interrupted / all-failed / partial
│   │       ├── RunningView.tsx    # barre de progression + ETA pendant l'exécution
│   │       ├── useProgressState.ts # hook throttle 100 ms + finalizeRender() synchrone
│   │       ├── useVigieProcessRun.ts # hook d'orchestration du run — estimate, abort, runningRef, logSession
│   │       └── errorMessages.ts   # mapping FR pour codes d'erreur process
│   │   └── archive/               # flows "Sauvegarder" (Phase 8) ET "Créer les zips à déposer" (Phase 9)
│   │       ├── ConstatScreen.tsx  # scan processed/ + writable + pré-check disque (statfs) ; en mode package, cleanOrphanStagingDirs
│   │       ├── ConfirmScreen.tsx  # aperçu / running / cleaning / run-error — Ctrl+C local pendant le run
│   │       ├── RunningView.tsx    # ProgressPanel piloté par les octets lus en source + ETA (+ compteur de volume)
│   │       ├── useArchiveProgressState.ts # throttle 100 ms + finalizeRender() synchrone, switch exhaustif sur VolumeProgressEvent
│   │       ├── useArchiveRun.ts   # orchestration mode-agnostique : triplet injecté, abort, runningRef, logSession
│   │       ├── backupBehavior.ts  # triplet du flow sauvegarde (createZipArchive, buildArchiveName, SessionEvent v3)
│   │       ├── packageBehavior.ts # triplet du flow dépôt (createZipVolumes, buildSeriesDirName, SessionEvent v4)
│   │       ├── ResultScreen.tsx   # sauvegarde — 2 variantes : succès / interrompu
│   │       ├── UploadResultScreen.tsx # dépôt — 2 variantes : succès (N volumes) / interrompu
│   │       └── errorMessages.ts   # mapping FR + isTransientArchiveError (transitoire vs définitif)
│   ├── format/                    # helpers d'affichage purs (ex-`lib/format/`, déplacé en 9.0)
│   │   ├── duration.ts            # formatDuration(seconds) → texte FR ("X secondes" / "X minutes" / "X h MM")
│   │   ├── bytes.ts               # formatBytes → "1,4 Go" (virgule décimale française)
│   │   └── progress.ts            # renderBar, formatShortDuration, buildRemainingLabel
│   ├── components/
│   │   ├── TextField.tsx          # label + ink-text-input (ou Text en mode managed) + aide/erreur
│   │   ├── ProgressPanel.tsx      # cadre commun des 3 RunningView (cwd, titre, compteurs, barre, stats, réassurance)
│   │   ├── DuplicateNamesScreen.tsx # écran partagé Préfixer/Découper : refus basename dupliqué racine/Brut(s)/
│   │   └── Footer.tsx             # footer de raccourcis stylé
│   ├── lib/
│   │   ├── vigie-chiro/
│   │   │   ├── prefix.ts          # buildPrefix({carre,annee,passage,point}) → "Car..."
│   │   │   ├── isAlreadyPrefixed.ts
│   │   │   ├── buildConstatCounts.ts # compteurs du Constat (alreadyPrefixed/upperCaseWav/otherIgnored)
│   │   │   └── validation.ts      # validators purs par champ
│   │   ├── archive/               # lib zip Phases 8-9 — writer ZIP maison, deflate, ZIP64, vérification, volumes
│   │   │   ├── crc32.ts           # table 256, CRC32_INITIAL / crc32Update / crc32Final
│   │   │   ├── zipFormat.ts       # builders binaires purs (LFH, CD, EOCD, ZIP64) + toDosDateTime
│   │   │   ├── planArchive.ts     # archived/, buildArchiveName, formatDateStamp, collisionNameCandidates, scan de processed/
│   │   │   ├── planUpload.ts      # upload/, buildSeriesDirName, buildVolumeFileName, buildStagingDirName
│   │   │   ├── createZipArchive.ts # orchestration streaming deflate + patch pwrite + sync/verify/rename + maxBytes/zip64
│   │   │   ├── createZipVolumes.ts # série de volumes : staging, bascule dynamique, complétude, commit, cleanOrphanStagingDirs
│   │   │   ├── deflateBound.ts    # borne inconditionnelle de sortie deflate (cf. § Borne de compression)
│   │   │   ├── maxVolumeBytes.ts  # plafond par volume (3,5 Gio) + clamp dur de CHIRO_MAX_VOLUME_BYTES
│   │   │   ├── verifyZipArchive.ts # complétude vs plan + structure + CRC spot/full
│   │   │   └── __tests__/         # crc32, zipFormat, planArchive, planUpload, createZipArchive, createZipVolumes, zip64, noZip64, deflateBound, maxVolumeBytes, golden, externalTools
│   │   ├── progress/
│   │   │   └── renderThrottle.ts  # THROTTLE_MS + shouldRenderNow — partagé par les 2 hooks de progression
│   │   ├── fs/
│   │   │   ├── scanDirectory.ts   # scan unique des 3 flows : scanDirectory (racine + Brut(s)/, 1 niveau, fusionné, refuse les basenames dupliqués) + sumFileSizes + checkProcessedDirConflict + isVisibleNonTmpEntry
│   │   │   ├── safeFsOps.ts       # renameWithFallback (EXDEV) + writeFileAtomic (.tmp + rename)
│   │   │   ├── planRenames.ts     # produit la liste {from, to, skipReason?}
│   │   │   └── applyRenames.ts    # consume renameWithFallback, séquentiel, gestion SIGINT
│   │   ├── audio/                 # lib audio Phase 5-7 — split + TE×10 lossless + perf + métadonnées
│   │   │   ├── batchPlan.ts       # politique commune A/B : admission (regex, cap 500 MB), processed/, concurrence, buildChunkName
│   │   │   ├── constants.ts       # CHUNK_OUTPUT_SECONDS=50, CHUNK_REAL_SECONDS=5, TIME_EXPANSION_FACTOR=10
│   │   │   ├── splitWavFile.ts    # Generator<chunk|abort|error> ; pas d'I/O
│   │   │   ├── processWavFiles.ts # orchestrateur — route vers soxFastPath ou splitWorkerPool, gère le fallback
│   │   │   ├── splitWorkerPool.ts # Pipeline A — pool de node:worker_threads, dispatch, abort, dead-worker handling
│   │   │   ├── splitWorker.ts     # source TS du worker (pré-bundlé en splitWorker.bundled.mjs, gitignored)
│   │   │   ├── soxFastPath.ts     # Pipeline B — spawn sox concurrent, spot-check, cleanPartialOutput
│   │   │   ├── wavHeader.ts       # rewriteHeaderToStandardPcm — header canonique unique A/B
│   │   │   ├── finalizeChunk.ts   # wrappe wavHeader + appendAncillaryChunks (GUANO/wamd)
│   │   │   ├── estimateChunks.ts  # estimation pré-run pour dimensionner la barre de progression
│   │   │   ├── etaTracker.ts      # ETA byte-weighted, moyenne glissante 5 fichiers
│   │   │   ├── metadata/
│   │   │   │   ├── guano.ts       # chunk `guan` GUANO 1.0
│   │   │   │   ├── wamd.ts        # chunk `wamd` Wildlife Acoustics
│   │   │   │   └── chunkMetadata.ts # orchestrateur per-chunk (guano, wamd)
│   │   │   └── __tests__/         # fixtures.ts + tests unitaires/intégration/golden — cf. § Tests
│   │   ├── files/
│   │   │   └── parseTimestamp.ts  # parse `_YYYYMMDD_HHMMSS` depuis le nom de fichier source
│   │   ├── errors/
│   │   │   └── describeError.ts   # mapping code d'erreur → message FR bienveillant
│   │   ├── runtime/
│   │   │   ├── isHomebrewInstall.ts # détecte un install Homebrew via realpathSync(process.execPath)
│   │   │   ├── metadataEnabled.ts # kill-switch CHIRO_DISABLE_METADATA (les screens ne lisent jamais process.env)
│   │   │   └── installDir.ts      # CHIRO_INSTALL_DIR override pour que le self-update cible le binaire réellement lancé
│   │   ├── selftest/
│   │   │   └── selfTest.ts        # --self-test : exercice binaire compilé de bout en bout
│   │   ├── update/
│   │   │   ├── constants.ts       # GITHUB_REPO, RELEASES_API_URL, INSTALL_SCRIPT_URL, TTL, cache path
│   │   │   ├── parseVersion.ts    # semver-light parser
│   │   │   ├── compareVersions.ts # semver §11 precedence
│   │   │   ├── fetchLatestVersion.ts # GitHub Releases API, Result tagué, AbortSignal
│   │   │   ├── cache.ts           # ~/.chiro/update-check.json : read/write atomique + isCacheFresh
│   │   │   └── checkForUpdate.ts  # orchestrateur cache → fetch → compare, silent fail
│   │   ├── logging/
│   │   │   ├── log.ts             # append JSONL dans ~/.chiro/sessions.jsonl
│   │   │   ├── buildVigieProcessSessionEvent.ts # SessionEvent v2 depuis un ProcessResult
│   │   │   ├── buildArchiveSessionEvent.ts # SessionEvent v3 depuis un CreateZipArchiveResult
│   │   │   └── buildPackageSessionEvent.ts # SessionEvent v4 depuis un CreateZipVolumesResult
│   │   └── e2e.test.ts            # round-trip complet sur dossier mkdtemp
├── .gitattributes                 # LFS pour test-data/
├── .gitignore
├── .prettierignore
├── .prettierrc
├── eslint.config.js
├── package.json                   # pas de champ "bin" — pnpm dev = build:worker && `bun src/index.tsx` ; version injectée à la compile via version.ts
├── tsconfig.json
├── vitest.config.ts
└── README.md                      # racine — utilisateur final (install + usage rapide)
```

Convention tests : la plupart des fichiers `*.test.ts(x)` sont colocalisés à côté du code qu'ils testent (ex. `prefix.ts` / `prefix.test.ts`, `MenuScreen.tsx` / `MenuScreen.test.tsx`). Certains dossiers regroupent leurs tests (et fixtures partagées) dans un sous-dossier `__tests__/` — convention adoptée en Phase 5 : `src/lib/audio/`, `src/lib/audio/metadata/`, `src/lib/archive/`, `src/lib/files/`, `src/lib/progress/`, `src/format/`, `src/components/`, `src/screens/vigie-chiro/`, `src/screens/vigie-process/`, `src/screens/archive/`. Non listés fichier par fichier ci-dessus.

### Principes de séparation

- **`src/lib/`** : 100% TypeScript pur, **aucun import** de `ink`, `react`, ni `ink-text-input`. Tout est testable en `vitest` sans rendu Ink. Cible : couverture 100%.
- **`src/screens/`** : composants Ink qui orchestrent. Ils appellent `lib/`, jamais l'inverse. Pas de logique métier ici (si elle dépasse 5 lignes, elle migre dans `lib/`). Aucun `process.env` dans les screens : tout kill-switch passe par une fonction `lib/` nommée (`metadataEnabled`, `detectSox`…).
- **Hooks `use*.ts` colocalisés dans `screens/<flow>/`** : orchestration de cycle de vie (état du run, AbortController, `runningRef`, logging) — zéro JSX, zéro logique métier (déléguée à `lib/`). Pattern de référence : `useVigieProcessRun`.
- **`src/components/`** : composants Ink réutilisables (visuel). Pas de logique non plus. Peuvent importer `src/format/`.
- **`src/format/`** (ex-`src/lib/format/`, déplacé en Phase 9.0) : fonctions **pures de présentation** (`formatBytes`, `formatDuration`, `renderBar`…). N'importe ni `ink`/`react`, ni `lib/`, ni `screens/`. Le déplacement était la seule façon d'extraire `components/ProgressPanel.tsx` (facteur commun des trois `RunningView`) sans ajouter un « sauf » à la règle `components/ ∌ lib/` : vérifié avant de bouger, aucun module de `lib/` n'importait ce dossier et aucun de ses fichiers n'a d'import `node:` — il était mal rangé, pas mal contraint.
- **`src/types.ts`** : types partagés (entrées formulaire, plan de renommage, événement de log). Pas de comportement.

Ces règles sont **machine-enforced** par `eslint.config.js` (`no-restricted-imports`, blocs « Architecture boundaries ») : un bloc par couche (`lib/`, `format/`, `components/`) plus **un bloc par flow d'écrans** — `vigie-chiro/`, `vigie-process/`, `archive/` — chacun interdisant l'import des deux autres. Ajouter un flow = ajouter son bloc **et** l'ajouter à la liste d'interdits des blocs existants ; les fichiers de test sont exemptés (ils croisent légitimement les couches).

**Piège (régression réelle, corrigée en Phase 9)** : `no-restricted-imports` matche la **chaîne d'import littérale**, pas le chemin résolu. Un motif `**/screens/vigie-process/**` ne bloque donc **pas** `../vigie-process/x.js`, la forme qu'un import inter-flux prend réellement. Chaque bloc liste les **deux** formes (qualifiée + relatives `../` et `../../`). Et un motif nu `**/vigie-chiro/**` est faux dans l'autre sens : il bloquerait `src/lib/vigie-chiro/`, module métier que `screens/archive/` importe légitimement (`extractCommonPrefix`).

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
  | { kind: "process:result"; input: ProcessInput; outcome: ProcessOutcome }
  | { kind: "archive:constat" }
  | {
      kind: "archive:confirm";
      entries: ArchiveEntryStat[];
      totalBytes: number;
    }
  | { kind: "archive:result"; outcome: BackupOutcome }
  | { kind: "package:constat" }
  | {
      kind: "package:confirm";
      entries: ArchiveEntryStat[];
      totalBytes: number;
    }
  | { kind: "package:result"; outcome: PackageOutcome };
```

Les états `archive:*` (sauvegarde, Phase 8) et `package:*` (dépôt, Phase 9) sont **distincts** alors qu'ils rendent les mêmes composants `screens/archive/` : la seule différence de comportement est le triplet injecté (`backupBehavior` / `packageBehavior`, mémoïsés dans `app.tsx`), et les écrans reçoivent en plus un `mode: "backup" | "package"` qui ne pilote **que** la copie.

Transitions :

```
menu --select "Préfixer"--> vigie:constat
menu --select "Découper"--> process:constat
menu --select "Créer les zips à déposer"--> package:constat
menu --select "Sauvegarder (un seul zip)"--> archive:constat
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

# Flow Sauvegarder — un seul zip (Phase 8)
archive:constat --Entrée--> archive:confirm  (si processed/ peuplé, writable, espace OK)
archive:constat --Échap--> menu
archive:confirm --Entrée--> createZipArchive → archive:result (+ logSession v3)
archive:confirm --Ctrl+C pendant le run--> abort → archive:result (interrompu)
archive:confirm --Entrée sur run-error transitoire--> archive:confirm (aperçu re-résolu)
archive:confirm --Échap--> archive:constat
archive:result --Entrée--> menu

# Flow Créer les zips à déposer — série de volumes (Phase 9)
package:constat --Entrée--> package:confirm  (mêmes checks + cleanOrphanStagingDirs)
package:constat --Échap--> menu
package:confirm --Entrée--> createZipVolumes → package:result (+ logSession v4)
package:confirm --Ctrl+C pendant le run--> cleaning → abort → package:result (interrompu)
package:confirm --Entrée sur run-error transitoire--> package:confirm (aperçu re-résolu)
package:confirm --Échap--> package:constat
package:result --Entrée--> menu
```

Aucun des deux flows zip n'a d'écran de saisie : rien n'est paramétrable, tout est déduit du `cwd`. Une erreur de run ne produit pas d'écran dédié — elle reste sur l'écran de confirmation en variante `run-error`, d'où `Échap` renvoie au Constat pour un nouveau scan et `Entrée` propose un réessai **uniquement si le code est transitoire** (`isTransientArchiveError`).

L'état intermédiaire **`cleaning`** (entre `running` et la sortie) est propre au flux de dépôt dans son intention : `createZipVolumes` détruit son staging (jusqu'à plusieurs Go) avant de retourner `aborted`, soit 10 à 60 s sur un disque externe pendant lesquelles l'écran afficherait sinon un « Fichier zip 3 » figé avec Ctrl+C apparemment inopérant — indiscernable d'un plantage. Le `rm` n'est délibérément **pas** fire-and-forget (on retomberait sur un staging partiel). L'état existe dans `useArchiveRun`, donc le flux sauvegarde le traverse aussi, en quelques millisecondes (un seul `unlink`).

L'`App` tient le state via `useState<Screen>` et passe des callbacks aux écrans. Pas de Redux, pas de Context, pas de routeur.

**Auto-check au boot** : un `useEffect` au mount d'`App` lance `checkForUpdate({ currentVersion: CHIRO_VERSION })` (test seam : `bootChecker?` injectable). Le résultat est stocké dans `availableVersion: string | null` et passé à `MenuScreen` qui affiche le hint jaune si non-null. Cleanup avec `AbortController` + flag `cancelled` au démontage.

**Pattern drapeau post-Ink** : pour lancer `install.sh` proprement, on ne spawn pas pendant que Ink dessine (stdout serait contesté). À la place :

1. `App` reçoit une prop `onRequestUpdate: () => void` depuis `index.tsx`.
2. Sur confirmation d'install dans `UpdateScreen`, App appelle `onRequestUpdate()` puis `useApp().exit()` synchronement.
3. Dans `index.tsx`, le callback pose un drapeau interne ; après `await render(...).waitUntilExit()`, si le drapeau est posé, on lance `spawnSync("bash", ["-c", "curl -fL ${INSTALL_SCRIPT_URL} | bash"], { stdio: "inherit" })` puis `process.exit(proc.status ?? 0)`.
4. Ink est unmount avant le spawn, donc stdout/stderr sont libres pour `install.sh`.

### Contrat `install.sh`

`UpdateScreen` invoque `install.sh` via `INSTALL_SCRIPT_URL`, **épinglé sur le tag de la version courante** (`v${CHIRO_VERSION}`, depuis le Chantier D) — plus `main`. Un binaire donné se met donc toujours à jour avec LE script publié avec sa propre release, jamais avec un `main` potentiellement cassé entre deux releases. Le `curl | bash` documenté dans le README pour la toute première installation, lui, reste pointé sur `main` (pas de version locale à épingler à ce stade) : c'est `FALLBACK_INSTALL_SCRIPT_URL` (même fichier `src/lib/update/constants.ts`), utilisé uniquement dans le message affiché si le script épinglé échoue (`exitCode !== 0` dans `index.tsx`). Tant que ce contrat tient, l'update fonctionne :

- **URL versionnée, jamais rétroactivement cassée** : `https://raw.githubusercontent.com/zaratan/chiro-tools/v<version>/scripts/install.sh` — le contenu d'un tag Git ne change jamais après coup, donc chaque binaire utilise pour toujours exactement le script publié avec sa release. Contrepartie assumée : un bug bloquant dans le `install.sh` d'une release passée reste bloquant pour le self-update de cette version-là (d'où le message de fallback ci-dessus). `bash -n scripts/install.sh` tourne en CI (`ci.yml`) pour au moins garantir que `main` reste syntaxiquement valide — `scripts/` est hors tsconfig/eslint, donc rien d'autre ne le vérifie en continu. Note maintainer : seul `release.yml` réécrit `package.json` sur le tag au build ; un run local (`bun src/index.tsx`) pin donc sur le tag correspondant à la version _committée_, pas un 404 — ce tag existe forcément (c'est une ancienne release), le script exécuté est simplement potentiellement périmé.
- **Contrat gelé, additif seulement** : les noms d'assets (`chiro-<os>-<arch>.tar.gz`) et le schéma d'URL de release (`releases/{latest/download,download/<tag>}/<asset>`) sont maintenant consommés par un `install.sh` figé dans chaque tag déjà publié. Les renommer casserait le self-update de toutes les versions déjà installées — toute évolution doit être additive (nouvel asset, pas de renommage d'un existant).
- **Pas d'interactivité** : le script ne lit jamais stdin (pas de `read -p`, pas de prompt sudo).
- **Cible fixe** : place le binaire dans `~/.local/bin/chiro` (ou respecte `$CHIRO_INSTALL_DIR` si fourni).
- **Idempotent** : ré-exécuter le script doit produire le même état final.
- **Exit code 0 = succès, autre = échec** : `chiro` propage ce code via `process.exit(proc.status ?? (proc.signal !== null ? 130 : 1))`, et affiche un message pointant vers `FALLBACK_INSTALL_SCRIPT_URL` en cas d'échec (`exitCode !== 0`).
- **Pas de quarantine attribute** : assumé OK car `curl | bash` ne pose pas l'attribut com.apple.quarantine.
- **Intégrité** : `install.sh` télécharge `SHA256SUMS` (publié par `release.yml`, à côté des deux tarballs) et vérifie la somme du tarball avant extraction. Fail-open (warning, install continue) si `SHA256SUMS` est absent — releases antérieures au Chantier D — si aucun outil de hash (`sha256sum`/`shasum -a 256`) n'est dispo, ou si le fichier ne liste pas l'asset courant (release cassée) ; échec dur uniquement sur un mismatch avéré. La menace couverte est la corruption/troncature réseau — sums et tarball viennent de la même release GitHub, ce n'est pas une protection contre une origine compromise.

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

**État actuel** : `release.yml` (job `build-macos`) applique une signature **ad-hoc** (pas de compte Developer ID, pas de notarisation) :

```bash
codesign --sign - --force --timestamp=none dist/chiro-darwin-arm64
```

Un binaire téléchargé via `curl` ne reçoit pas l'attribut `com.apple.quarantine` (l'attribut est posé par les applications qui optent pour `LSFileQuarantineEnabled` — les navigateurs — pas par `curl`), donc le blocage Gatekeeper « app non notarisée » du premier lancement ne s'applique pas à ce chemin d'installation. La signature ad-hoc reste nécessaire pour une autre raison : macOS sur Apple Silicon refuse d'exécuter tout binaire natif dépourvu d'au moins une signature (ad-hoc comprise), et le `codesign --force` post-build garantit une signature valide sur le binaire final. Hypothèse quarantine posée en Phase 4, jamais invalidée depuis par un test sur machine vierge.

L'auteur dispose d'un **compte Apple Developer** actif — une signature Developer ID + notarisation reste une option, réservée à la Phase 4.5 **conditionnelle**, à activer uniquement si un futur test sur machine vierge révèle un blocage Gatekeeper. Étapes prévues si cette phase s'active un jour :

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

L'identifiant exact du certificat et le team ID seront demandés au moment d'activer la Phase 4.5. **Ne pas hardcoder** ces valeurs dans le repo — utiliser GitHub Secrets.

## Distribution

### MVP (Phase 4)

- **GitHub Releases** héberge les 2 assets, empaquetés en **tarball** (`chiro-darwin-arm64.tar.gz`, `chiro-linux-x64.tar.gz` — `brew audit --new --strict` exige un asset stable versionné en archive, pas un binaire nu).
- **`scripts/install.sh`** (réel, dans le repo) : détecte `$OS-$ARCH`, télécharge le tarball de la version voulue (`CHIRO_VERSION`, défaut `latest`), vérifie sa somme SHA256 contre `SHA256SUMS` (publié par `release.yml` à côté des tarballs — fail-open si absent ou si aucun outil de hash n'est dispo sur la machine, échec dur si mismatch, cf. § Self-update ci-dessous), puis l'extrait dans un fichier temporaire et `mv` atomique vers `$CHIRO_INSTALL_DIR/chiro` (`CHIRO_INSTALL_DIR` défaut : `~/.local/bin`) — aucune écriture destructive avant ce `mv` final, invariant nécessaire puisque le script tourne aussi via `curl | bash` depuis le self-update intégré. Warning best-effort si le dossier cible n'est pas dans `$PATH`.
- L'utilisatrice (ou son conjoint dév) lance :
  ```bash
  curl -fL https://raw.githubusercontent.com/zaratan/chiro-tools/main/scripts/install.sh | bash
  ```
- Une fois `~/.local/bin` dans `$PATH`, `chiro` est disponible globalement.

### V2 (différé)

- **Brew tap perso** (`homebrew-chiro`) — formula tire les mêmes assets depuis les GH Releases.
- Auto-update intégré (notification "version X.Y disponible" au boot).
- Linux arm64, macOS Intel x64.

## Logging

- Fichier : `~/.chiro/sessions.jsonl` (`~/.chiro/` est créé paresseusement au premier `logSession`).
- Format : **JSONL** (un objet JSON par ligne, `\n` séparateur).
- Mode : **append** (`fs.appendFile`). Jamais tronqué au MVP.
- Schéma : cf. `spec.md` § "Logging local".
- Une seule entrée par run de wizard (à la fin, succès OU échec OU interruption).
- **`SessionEvent` est une union discriminée sur `schema_version`** :
  - `v1` → action `vigie-prefix` (wire format **byte-stable** — assertion par snapshot test, toute modif accidentelle fait échouer `pnpm check`)
  - `v2` → action `vigie-process` (introduit en Phase 5)
  - `v3` → action `vigie-archive` (Phase 8) — **retiré**, remplacé par v5. Plus jamais écrit ; les lignes déjà sur disque gardent cette forme
  - `v4` → action `vigie-package` (introduit en Phase 9) — même forme que v3, plus `series_dir`, `volume_count`, `volumes[]` (borné à 50), `max_volume_bytes`, `durable`. Le nom `vigie-upload` est délibérément laissé libre : chiro **prépare** les fichiers, il ne dépose rien (le futur upload Glacier, lui, le fera vraiment)
  - `v5` → action `vigie-archive` (révisé après la Phase 9) — v3 plus `durable`
- **`schema_version` est un discriminant de _forme_, pas un numéro de version du format.** Il n'y a jamais eu de « migration v1 → v2 ». La règle exacte : **une forme = un numéro ; une `action` peut en avoir plusieurs dans le temps, dont un seul courant.** Changer la forme d'un événement existant prend donc **un numéro neuf** (v3 → v5 pour `vigie-archive`), jamais un « v3.1 », jamais un champ ajouté en place.

  Ce point a déjà été écrit à l'envers ici (« demanderait autre chose qu'un incrément — nouveau champ optionnel, ou nouvelle `action` »). C'est faux, et c'était un piège pour la prochaine phase qui touchera au journal : un **champ optionnel** est précisément ce qu'on refuse quand il garde une décision (cf. `durable`, qui a motivé v5), et une **nouvelle `action`** mentirait sur ce que le run a fait.

- Les entrées v3 ne sont plus représentables par le type `SessionEvent`, qui est un type d'**écriture**. Aucun lecteur n'existe dans le repo ; le jour où il en faudra un, il portera son propre type couvrant les formes historiques.
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

Trois responsabilités, trois modules :

- **`src/lib/audio/processWavFiles.ts`** — routeur (~50 lignes) : choisit le moteur (sox si `options.sox` fourni, worker pool sinon), applique la politique de fallback per-batch first-error, pose `engine` / `engine_fallback_count` / `metadata` sur le `ProcessResult`.
- **`src/lib/audio/batchPlan.ts`** — politique d'admission commune aux deux moteurs : filtre regex `_\d{3}\.wav$` → `skippedAlreadyChunked`, `stat` + cap `maxInputBytes` (500 MB) → `skippedTooLarge`, constitution de la file (`buildQueue`), nom du dossier de sortie, heuristique de concurrence, `buildChunkName` (la convention `_NNN.wav` que la regex doit reconnaître).
- **`splitWorkerPool.ts` / `soxFastPath.ts`** — exécution : lecture, split, écriture atomique (`.tmp` puis `rename`, fallback `EXDEV`), retour `ProcessOutcome` avec processed / errored / skipped / interrupted / durationMs.

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

### Pattern `useVigieProcessRun` (extraction réalisée — chantier C, août 2026)

Le hook (`src/screens/vigie-process/useVigieProcessRun.ts`) possède : la machine d'état du run (estimate → preview → running → run-error), l'`AbortController`, le `runningRef` consulté par le Ctrl+C global, l'appel `logSession` (via `lib/logging/buildVigieProcessSessionEvent`). Le screen possède : le rendu et le mapping touches → actions (`abort()` exposé par le hook, câblé au Ctrl+C par le screen). Le métier est entièrement en `lib/` (`estimateChunkCount`, `processWavFiles`, `metadataEnabled`).

C'est le pattern de référence pour les futurs écrans V2 (undo, batch). Deux mises en garde avant de le recopier : le handshake impératif `registerRunningViewHandles` (refs passées enfant → hook via `onMount`) fonctionne ici mais un second écran devrait plutôt faire posséder `useProgressState` directement par le hook ; et l'effet d'estimation dépend de la stabilité de `wavFiles` fournie par `app.tsx`.

## Performance pipeline (Phase 6)

Le découpage est CPU-bound : `wavefile.toBuffer()` ré-encode header + samples par chunk (~30–50 ms × 5–6 chunks × N fichiers). Sur dataset réel (9301 fichiers AudioMoth/Teensy déjà préfixés), le pipeline mono-thread initial prend ~3h30. Phase 6 livre deux optimisations cumulables : worker pool wavefile (toujours actif) et fast-path sox (opt-in).

### Politique de batch commune — `src/lib/audio/batchPlan.ts`

Extraite des deux pipelines (chantier A, août 2026) pour rendre leur divergence structurellement impossible — une seule source pour : `ALREADY_CHUNKED_REGEX` (`_\d{3}\.wav$`, skip des chunks déjà produits), `DEFAULT_MAX_INPUT_BYTES` (500 MB), `PROCESSED_DIRNAME`/`buildOutDir`/`PROCESSED_DIR_DISPLAY`, `buildQueue` (la boucle d'admission complète), `makeEmit` (throttle de progression), `clampWorkerCount`/`computeConcurrency` (heuristique ci-dessous, partagée par les deux moteurs), et `buildChunkName` (production du nom `_NNN.wav` — partagée pour que la regex reconnaisse toujours sa propre sortie).

**Invariants partagés A/B** : (1) admission → `batchPlan`, (2) header canonique → `wavHeader.rewriteHeaderToStandardPcm`, (3) nommage de sortie → `batchPlan.buildChunkName`. Tout nouvel invariant inter-pipelines doit vivre ici, pas être dupliqué.

### Pipeline A — Worker pool wavefile

`src/lib/audio/splitWorkerPool.ts` orchestre N workers `node:worker_threads` qui exécutent chacun `splitWavFile` sur un fichier dédié. Le pool fait la queue files-as-tasks, dispatche au prochain worker idle, agrège les `ProgressEvent` avec un throttle de 100 ms (10 Hz). Gain attendu 3–6× selon la machine.

`N` calculé dynamiquement au mount (`batchPlan.clampWorkerCount`) :

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

Le kill-switch `CHIRO_DISABLE_METADATA=1` est lu par `lib/runtime/metadataEnabled.ts` (appelé par `useVigieProcessRun` — les screens ne lisent jamais `process.env`) ; il est propagé via `ProcessOptions.metadata.enabled = false`. État tracé dans `SessionEvent.result.metadata: "full" | "off"`. Le timestamp source est parsé depuis le filename (`src/lib/files/parseTimestamp.ts`) — pattern `_YYYYMMDD_HHMMSS` ancré pour éviter de matcher l'année du préfixe Vigie-Chiro (`Car…-2026-…`). Si non parsable, la ligne `Timestamp:` est omise du GUANO et le record `0x0005` est omis du wamd.

### Routage et politique fallback

`processWavFiles.ts` route selon `options.sox` (passé par `App.tsx` après `detectSox`) :

```ts
if (options?.sox) {
  const soxResult = await runSoxBatch(
    options.sox.binPath,
    files,
    dir,
    input,
    poolOptions,
  );
  if (soxResult.kind === "completed") {
    return {
      ...soxResult.outcome,
      engine: "sox",
      engine_fallback_count: 0,
      metadata: metadataLabel,
    };
  }
  // Fallback: run the full batch via worker pool
  const poolOutcome = await runPool(files, dir, input, poolOptions);
  return {
    ...poolOutcome,
    engine: "wavefile",
    engine_fallback_count: 1,
    metadata: metadataLabel,
  };
}
const outcome = await runPool(files, dir, input, poolOptions);
return {
  ...outcome,
  engine: "wavefile",
  engine_fallback_count: 0,
  metadata: metadataLabel,
};
```

Il n'y a pas de fonction `logSessionFallback` : le pipeline réellement utilisé et le compte de fallback sont simplement portés sur le `ProcessResult` retourné (`engine`, `engine_fallback_count`), et c'est `useVigieProcessRun` qui les transmet à `logSession` via `lib/logging/buildVigieProcessSessionEvent` au moment de construire le `SessionEvent` v2.

**Politique per-batch first-error** : si sox crashe OU si spot-check échoue sur le 1er fichier, **tout le batch** retraite via le worker pool (pas de mix per-file). Un seul invariant à vérifier, pas de drift inter-pipeline au sein d'un batch. Si sox foire seulement à partir du fichier #3 (le 1er a validé), c'est probablement un fichier corrompu — log warning, ajoute à `errored`, continue le batch. `SessionEvent.result.engine` et `engine_fallback_count` enregistrent le pipeline réellement utilisé.

### Safety nets (priorité données scientifiques)

1. **Header canonique unique A/B** (cf. ci-dessus) — invariant testable.
2. **Spot-check stratifié** sur le 1er fichier sox : 3 chunks (1er, milieu, dernier), 100 samples au milieu de chaque chunk comparés à la référence produite par le pipeline wavefile (A-vs-B en une seule traversée du générateur — pas de formule analytique). Mismatch → fallback immédiat du batch.
3. **Golden CI test** (`__tests__/golden.test.ts`) sur 3 fixtures synthétiques (rampes déterministes) : déterminisme du pool (run₁ = run₂) puis byte-identité pool ↔ sox (`describe.skipIf(!soxAvailable)`). Pas de SHA hardcodés — comparaison A/B. CI matrix `sox: [with, without]` couvre les deux pipelines.
4. **Env opt-out** `CHIRO_DISABLE_FASTPATH=1` : force le worker pool même si sox détecté. Utile pour debug et reproductibilité.
5. **Résilience worker pool (passe de durcissement, août 2026)** : chaque worker est écouté sur `"error"` **et** `"exit"` (un `process.exit(0)` en cours de fichier ne déclenche que `"exit"`, jamais `"error"` — sans ce second listener, un tel crash laisserait le batch pendre indéfiniment). Un flag `alive` par worker évite le double traitement quand les deux events se déclenchent pour la même mort. Un worker mort marque son fichier en cours comme `errored` (raison dédiée) et libère le reste du batch ; si tous les workers meurent, la queue restante est basculée en erreur proprement plutôt que de pendre.
6. **No-throw côté sox** : `processOneFile` (dans `soxFastPath.ts`) encapsule tout le traitement d'un fichier dans un `try/catch/finally` — toute erreur (spawn, header, écriture) retombe sur `failWithCleanup`, qui appelle `cleanPartialOutput` pour garantir qu'aucun chunk partiel du fichier en échec ne survit dans `processed/`, et le `finally` nettoie systématiquement le sous-dossier temporaire `.sox-tmp-<baseName>`.

### Auto-update — kill-switch en install gérée externalement

`src/lib/runtime/isHomebrewInstall.ts` résout `process.execPath` via `realpathSync` et retourne `true` si le path contient `/Cellar/` (canonical Homebrew layout, vrai sur `/opt/homebrew/Cellar/` macOS arm64 et `/home/linuxbrew/.linuxbrew/Cellar/` Linuxbrew). `src/index.tsx` calcule `autoUpdateDisabled = isHomebrewInstall() || process.env.CHIRO_DISABLE_AUTOUPDATE === "1"` et propage à `<App>`. Quand `true` :

- Le boot check `useEffect` dans `app.tsx` early-returns (aucun fetch réseau, aucun cache disque).
- `MenuScreen` filtre l'entrée "Vérifier les mises à jour" hors de `items` (silencieux total, pas de footer note).
- `UpdateScreen` early-returns un JSX qui pointe vers `brew upgrade chiro` (garde défensive — inatteignable via le menu).

Kill-switch utilisateur : `CHIRO_DISABLE_AUTOUPDATE=1` (seule la valeur littérale `"1"` est reconnue, cohérent avec `CHIRO_DISABLE_FASTPATH` / `CHIRO_DISABLE_METADATA`). Raison d'être : permettre à un power-user installé via `install.sh` de désactiver l'auto-check (ex. environnement air-gapped, debug du flow update lui-même).

Edge case maintainer : si `bun` lui-même est brew-installé (`brew install oven-sh/bun/bun`), `pnpm dev` voit `process.execPath` dans `/Cellar/` et désactive l'auto-update en dev. Accepté — n'affecte que le maintainer du projet, et le kill-switch en dev est de toute façon désirable.

### Asset embedding pour les workers (`bun --compile`)

`splitWorker.ts` (source TS strict) est pré-bundlé via `bun build` (`pnpm build:worker`, chaîné explicitement en `&&` en tête des scripts dev/test/build/check — pas de hooks `pre*`) en `splitWorker.bundled.mjs`. Ce bundle est embarqué dans le binary compilé via :

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

## Module `lib/archive` (Phases 8 et 9)

Écrit, à partir du contenu de `processed/`, **deux sorties différentes selon le flux appelant** :

| Flux           | Sortie                                                        | Entrée du module   | ZIP64                            |
| -------------- | ------------------------------------------------------------- | ------------------ | -------------------------------- |
| **Sauvegarde** | `archived/<préfixe>_YYYYMMDD.zip` — un objet unique, 10–20 Go | `createZipArchive` | **nominal**                      |
| **Dépôt**      | `upload/<série>/<série>_partN.zip` — volumes de 3,5 Gio       | `createZipVolumes` | **interdit** (`zip64: "forbid"`) |

Comportement fonctionnel dans `spec.md` (§ « Wizard "Sauvegarder les enregistrements découpés" » et § « Wizard "Créer les zips à déposer" »), wordings dans `ux.md`. Cette section documente le **comment** et surtout le **pourquoi**.

Réalité produit qui cadre les décisions de la Phase 8 : des zips de **10–20 Go**. ZIP64 y est donc le chemin nominal et non un cas limite, le run dure plusieurs minutes (ETA obligatoire), et compresser fait gagner du temps de transfert. **La Phase 9 renverse cette contrainte pour le seul flux de dépôt** : le portail Vigie-Chiro refuse le ZIP64 (confirmé par l'utilisatrice ; aucune limite de taille imposée par ailleurs), donc la série de volumes doit prouver qu'elle n'en écrit jamais — cf. § « Série de volumes » plus bas. Les deux sorties coexistent : le gros zip reste l'objet de sauvegarde (« dans trois ans, un client redemande les données de son étude » — un objet unique, nommé par le préfixe de l'étude, restaurable sans recoller de morceaux), la série est ce qu'on dépose.

### ADR — writer ZIP maison

**Contexte** : produire une archive zip lisible par le portail Vigie-Chiro, le Finder, Windows et Info-ZIP, à partir de milliers de fichiers WAV, depuis un binaire `bun --compile` autonome.

| Option                       | Pour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Contre                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Writer maison (choisi)**   | **Raison décisive** : `maxBytes` — clore un volume au dernier octet qui tient, en connaissant l'offset **réel** sur disque en cours de flux, puis finaliser et vérifier ce volume-là. Aucune lib ne l'expose, et c'est ce que le flux de dépôt exige. Viennent ensuite : `zip64: "forbid"` comme propriété **prouvable** (une lib décide seule), pas de data descriptor (yazl en émet quand les tailles sont inconnues — compat portail et Finder), contrôle de l'ordre d'écriture (`sync` avant verify), et seuils ZIP64 injectables, donc un chemin ZIP64 — **nominal** pour le zip de sauvegarde — testable en CI sans fixture de 4 Go. | **~2 070 lignes de source + ~3 470 de tests** (mesuré, pas estimé ; 1 200 / 2 100 à la Phase 8, la Phase 9 a ajouté la série de volumes et ses gardes). L'économie réelle face à `yazl` se limite à `zipFormat.ts` + `createZipArchive.ts` : `verifyZipArchive` aurait été écrit de toute façon. Mitigé : le sous-ensemble ZIP écrit est figé depuis 1993 et l'interface est étroite, donc réversible. |
| `yazl` / `archiver` (npm)    | Prêt à l'emploi.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Casse la règle « zéro dépendance runtime » pour un format qui ne bouge plus. Surtout : aucun n'expose l'offset disque réel en cours de flux, donc pas de clôture de volume au dernier octet qui tient. C'est le point dur, et il n'est pas contournable par-dessus.                                                                                                                                    |
| `spawn zip` (Info-ZIP / CLI) | Le plus court à écrire.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Fait de `zip` une **dépendance de correction** : absent → la feature ne marche pas. Précédent explicite avec sox (§ « Pipeline B ») : un binaire externe est un **accélérateur optionnel**, jamais un prérequis.                                                                                                                                                                                       |
| `tar` / `tar.gz`             | Trivial à produire.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Impasse pour la cible : double-clic inutilisable sur Windows, et le dépôt Vigie-Chiro attend un zip. Le format est imposé par l'aval, pas choisi.                                                                                                                                                                                                                                                      |

**Conclusion** : le writer maison est le seul choix qui préserve à la fois « binaire autonome », « zéro dépendance » et la bascule de volume sur la taille réelle.

⚠ **Cette cellule « Pour » a longtemps dit autre chose** : « posséder le chemin de vérification ». C'était faux, et la colonne « Contre » de la même ligne le disait déjà — `verifyZipArchive` relit un fichier fini, il vérifierait un zip produit par `yazl` à l'identique, et il aurait été écrit dans tous les cas. La vraie raison décisive (`maxBytes`) est une contrainte de la **Phase 9** : elle n'existait pas quand l'ADR a été rédigé en Phase 8. Un ADR n'est pas figé quand le monde qu'il décrit change — mais il doit alors être réécrit, pas complété.

#### Les trois statuts possibles d'un binaire externe

La ligne « `spawn zip` » ci-dessus oppose « accélérateur optionnel » et « prérequis », et cette dichotomie est incomplète. Elle a failli faire lire comme une dérive un choix qui n'en est pas un (déléguer un futur envoi vers Scaleway Glacier à `rclone`). Trois statuts, pas deux :

| Statut                       | Absent → que perd-on ?                 | Exemple                        | Acceptable ? |
| ---------------------------- | -------------------------------------- | ------------------------------ | ------------ |
| **Accélérateur avec repli**  | rien, c'est juste plus lent            | `sox` (fast-path de découpage) | oui          |
| **Capacité optionnelle**     | une fonction annexe, aucun chemin cœur | `rclone` (copie hors site)     | oui          |
| **Dépendance de correction** | une fonction **cœur** cesse de marcher | `spawn zip` — rejeté           | **non**      |

Le critère n'est donc pas « le binaire est-il requis pour que la fonction marche » — il l'est toujours pour la sienne — mais **« que perd l'utilisatrice s'il est absent »**. Pour `rclone` : rien de ce dont elle a besoin. Le zip de sauvegarde est produit localement quoi qu'il arrive ; elle le range où elle veut. La copie en ligne est un confort en plus, pas une étape du parcours.

Trois conditions pour que ce statut reste honnête — posées ici avant la Phase 10, respectées par elle (cf. § « Module `lib/offsite` » plus bas, dont la deuxième nuance légèrement la troisième par une exception documentée) :

- **Dégradation silencieuse, jamais en cours de route.** L'absence se constate au boot (comme `detectSox`) et se traduit par une entrée de menu qui n'apparaît pas — jamais par un échec après douze minutes de travail.
- **Aucun chemin d'intégrité de données ne passe par lui.** Il transporte une copie ; il ne produit ni ne vérifie l'archive.
- **Aucune action destructive n'est conditionnée à son auto-déclaration.** Le jour où « supprimer `processed/` » dépend du code de sortie de rclone, rclone cesse d'être une capacité optionnelle : il devient une dépendance de correction d'un chemin **destructif**, soit pire que ce que l'ADR refuse à `zip`. Si chiro supprime après un transfert, il doit re-vérifier le distant lui-même (taille et empreinte relues) ou ne pas supprimer. Formulé court : **rclone peut porter l'octet, il ne peut pas porter la preuve.** C'est la même exigence que celle qui a rendu `durable` obligatoire — on ne laisse pas une décision destructive reposer sur une valeur qu'on n'a pas vérifiée soi-même.

L'argument décisif en faveur de rclone n'est d'ailleurs pas la robustesse du transfert, c'est **le stockage des identifiants** : ils vivent dans `~/.config/rclone/rclone.conf`, posé par `rclone config`, et chiro n'en voit jamais un seul. Le fichier de réglages de chiro ne contient que le nom du remote, du bucket et du préfixe. Toute une classe de problèmes — permissions du fichier, fuite dans `sessions.jsonl` ou dans un message d'erreur — disparaît au lieu d'être gérée. Le follow-up qui a précédé la Phase 10 comptait « identifiants à ne pas stocker en clair » comme un coût de la fonctionnalité ; c'était en réalité la meilleure raison de choisir cette voie, confirmée par l'implémentation : `settings.ts` ne lit jamais rien qui ressemble à une clé d'accès.

### Découpage des modules

| Module                | Rôle                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crc32.ts`            | CRC-32 incrémental (table de 256, `CRC32_INITIAL` / `crc32Update` / `crc32Final`). Maison pour rester incrémental et testable ; couture évidente vers `zlib.crc32` si un profil le justifiait — improbable, deflate domine le coût.                                                                                                                                                            |
| `zipFormat.ts`        | **Builders binaires purs**, zéro I/O : LFH (30 o), entrée de central directory (46 o), EOCD (22 o), ZIP64 EOCD (56 o) + locator (20 o), extra field ZIP64, `toDosDateTime`. Ce que `createZipArchive` pose sur le disque et ce que `verifyZipArchive` relit.                                                                                                                                   |
| `planArchive.ts`      | `ARCHIVED_DIRNAME`/`buildArchivedDir`, `formatDateStamp` (le `YYYYMMDD` partagé par les deux name builders), `buildArchiveName(date, prefix?)` (pur), `collisionNameCandidates` (générateur `-2`…`-99`, source unique de la règle), `resolveFreeName`/`resolveArchiveFileName`, `scanProcessedForArchive` (Result tagué `no-processed` / `empty-processed` / `scan-error` / `aborted` / `ok`). |
| `planUpload.ts`       | `UPLOAD_DIRNAME`/`buildUploadDir`, `buildSeriesDirName(date, prefix?)` (→ `Car…_20260814` ou `depot_20260814`), `buildVolumeFileName(série, i, total)` (pas de suffixe si `total === 1`, zéro-padding dynamique au-delà de 9), `buildStagingDirName(série, pid)`. Purs.                                                                                                                        |
| `deflateBound.ts`     | Borne **inconditionnelle** de taille de sortie deflate (cf. § dédié) — sert à décider si la prochaine entrée tient encore dans le volume courant.                                                                                                                                                                                                                                              |
| `maxVolumeBytes.ts`   | Plafond par volume : 3,5 Gio par défaut, `CHIRO_MAX_VOLUME_BYTES` **clampé dur** dans `[1 Mio, MAX_UINT32 − 64 Mio]`.                                                                                                                                                                                                                                                                          |
| `createZipArchive.ts` | Orchestration d'**un** zip : `.tmp` → boucle d'entrées (LFH, deflate, patch) → central directory → EOCD → `sync` → verify → `close` → rename → `fsync` du répertoire. Émet `ArchiveProgressEvent`. Options `maxBytes` (→ `volume-full`) et `zip64: "allow" \| "forbid"`.                                                                                                                       |
| `createZipVolumes.ts` | Orchestration d'une **série** : staging caché, bascule dynamique de volume, vérification de complétude de la série, nommage `partN` et commit par un `rename` unique, `cleanOrphanStagingDirs`. Émet `VolumeProgressEvent`.                                                                                                                                                                    |
| `verifyZipArchive.ts` | Relecture indépendante du fichier produit : complétude contre le plan, structure, CRC.                                                                                                                                                                                                                                                                                                         |

Côté UI, `screens/archive/useArchiveRun.ts` porte le cycle de vie (résolution du nom, `AbortController`, `runningRef`, `logSession`) et `useArchiveProgressState.ts` le throttle d'affichage — même répartition que `useVigieProcessRun` / `useProgressState`. Le hook est **mode-agnostique** : il reçoit un triplet injecté (`runner`, `resolveTargetName`, `buildSessionEvent`) construit par `backupBehavior.ts` ou `packageBehavior.ts`, et `app.tsx` choisit lequel au routage. C'est l'extension d'un précédent qui existait déjà (le hook recevait `createZipArchive` en prop) : sept modules qui branchent sur une chaîne `mode`, c'est le drapeau qui prolifère. Le `mode` survit uniquement dans le JSX, près du rendu de la copie qu'il conditionne, et `errorMessages` reçoit un **libellé de dossier** (`"archived"` / `"upload"`) plutôt que le mode — une valeur ne peut pas engendrer de branches.

### Format binaire écrit

**Deflate niveau 6** (`zlib.createDeflateRaw`), pas `stored`. Mesure sur du contenu Teensy réel : sortie ≈ **36 %** de la taille source, débit bout en bout ≈ **28 Mio/s** — le CPU est largement payé par l'upload économisé, et les zips manuels déjà acceptés par le portail sont eux aussi compressés. L'idée reçue « les WAV ne compressent pas » ne tient pas sur des enregistrements ultrasoniques 16-bit.

**Pas de data descriptor** (bit 3 du flag jamais posé). Le local file header est écrit avec CRC et tailles à zéro, puis, une fois l'entrée streamée, **un seul pwrite de 12 octets** à `localHeaderOffset + CRC_FIELD_OFFSET` (= 14) réécrit les trois champs contigus CRC-32 / compressed size / uncompressed size. Le central directory, écrit en dernier, porte d'office les vraies valeurs. Un data descriptor aurait évité le pwrite, mais au prix d'une compatibilité plus incertaine chez les vieux lecteurs.

**Discipline `FileHandle` (le piège dur du module)** :

- **Un seul** `FileHandle`, ouvert en `"w"`. **Jamais `"a"`** : `O_APPEND` fait ignorer le paramètre `position` de `write()`, donc le patch de 12 octets atterrirait en fin de fichier — corruption silencieuse.
- Toutes les écritures passent par `fh.write(buf, 0, len, position)` avec offset suivi à la main, `await`ées une à une.
- **Aucun `createWriteStream`, aucun `pipeline()`** : un stream bufferise, et son flush entrelacé avec un pwrite explicite produit une corruption non déterministe. Le deflater est donc consommé comme `AsyncIterable` et chaque bloc de sortie est écrit à un offset explicite.

**Noms de fichiers** : `Buffer.from(name, "utf8")` (`nameBytesOf`) est l'**unique** source de longueur — champs `fileNameLength` du LFH et du CD, et toute l'arithmétique d'offsets. Utiliser `String.length` sous-compte dès le premier accent et produit une archive illisible (« Truncated central directory »), reproduit en review. Le flag UTF-8 `0x0800` est posé systématiquement, et les fixtures de test couvrent NFC **et** NFD (la forme réellement produite par APFS).

**Date DOS** : `toDosDateTime` clampe à `[1980-01-01, 2107-12-31]` et retombe sur 1980 pour un `Date` invalide. La borne haute n'est pas cosmétique : le champ année DOS tient sur 7 bits, et `writeUInt16LE` **throw** `ERR_OUT_OF_RANGE` au-delà — ce qui violerait le contrat no-throw du module.

**`versionMadeBy = 0x0014`** (octet haut 0 = MS-DOS) avec `externalFileAttributes = 0`. Ne jamais annoncer un host Unix (octet haut 3) tout en laissant les attributs à zéro : Info-ZIP extrairait alors les fichiers en mode `000`.

### ZIP64 conditionnel

Chemin nominal **du flux sauvegarde** sur les vrais volumes, donc testé en CI et non « au cas où ». Le flux de dépôt, lui, pose `zip64: "forbid"` et n'écrit jamais aucune de ces structures (§ « Garde-fou `zip64: "forbid"` »).

- **Les local headers ne sont jamais ZIP64.** Une entrée ≥ 4 Gio est refusée à l'admission (`entry-too-large`) — garde inatteignable (les fichiers découpés font quelques Mo) mais qui garantit que les champs 32 bits du LFH suffisent toujours.
- **Entrée de central directory** : si `localHeaderOffset` atteint le seuil, le champ offset est saturé à `0xFFFFFFFF`, la vraie valeur passe dans un extra field ZIP64 (tag `0x0001`, u64 seul), et `versionNeeded` passe à 45 **pour cette entrée uniquement** — les autres entrées et tous les LFH restent à 20.
- **EOCD** : un ZIP64 EOCD + son locator sont écrits devant l'EOCD classique dès que le nombre d'entrées ou la taille/l'offset du central directory débordent. L'EOCD classique est **toujours** écrit, saturé **champ par champ** (`Math.min(v, MAX)`), jamais remplacé en bloc : un lecteur non-ZIP64 lit ainsi ce qui tient encore (par ex. un compte d'entrées correct avec un offset saturé).
- **Seuils injectables** : `createZipArchive(…, { zip64Thresholds: { offset, entryCount } })`. Un test avec `{ offset: 64 }` sur trois petits fichiers exerce le chemin complet (décision, extra field, `versionNeeded`, EOCD64, locator, saturation) et le valide avec `unzip -t`, sans fixture de 4 Go. La validation manuelle sur un dossier réel > 4 Gio est une confirmation, pas la seule preuve.

### Ordre de finalisation

```
write entries → write CD → write EOCD → sync() → verify(.tmp) → close() → rename(.tmp → .zip)
```

Chaque étape a une raison d'être à sa place :

- **`sync()` avant tout** : sur APFS et ext4 (delayed allocation), `ENOSPC` ne se manifeste **pas** au `write()` mais au `fsync`/`close`. Sans ce `sync()` explicite, un disque plein produirait un zip tronqué déclaré « écrit avec succès ».
- **verify après `sync()`** : vérifier avant lirait le page cache et validerait joyeusement un fichier qui n'est pas sur le disque.
- **`close()` puis `rename` en dernier** : le nom final n'apparaît dans `archived/` qu'une fois le contenu vérifié. Le rename passe par `renameWithFallback` (fallback `EXDEV`, partagé avec le flow rename).
- N'importe quel échec en route → `unlink` du `.tmp` + Result tagué. **Aucun zip partiel n'existe jamais**, ce qui est exactement ce que promet le wording d'erreur (« Aucun fichier zip n'a été créé »).

Le `.tmp` porte le **PID** dans son nom (`<zip>.<pid>.tmp`). Le pré-nettoyage des `.tmp` orphelins (run précédent tué) ne supprime que ceux dont le PID ne correspond plus à un process vivant — une instance concurrente de chiro n'est jamais sabotée. **Convention différente de `safeFsOps.ts`**, qui utilise un UUID court : lui n'a pas besoin de distinguer un résidu mort d'un tmp en vol, l'archive si. Deux conventions volontaires, pas un oubli.

### Vérification post-écriture — `verifyZipArchive`

Relit le `.tmp` avant le rename, trois couches, la moins chère d'abord. Ce n'est **pas** un lecteur indépendant (il assume l'EOCD à `taille - 22` au lieu de le chercher à rebours) : l'indépendance vient de `externalTools.test.ts`, qui confronte la sortie à trois extracteurs réels.

1. **Complétude** — en deux temps, et l'ordre compte. D'abord `createZipArchive` compare l'ensemble des noms **demandés par l'appelant** (`opts.entries`) à ceux réellement écrits : sans ça la vérification serait auto-référentielle, une entrée silencieusement sautée disparaissant à la fois de l'archive _et_ de la référence, avec toutes les couches au vert. Ensuite `verifyZipArchive` compare `{name, uncompressedSize}` au central directory relu. C'est la garantie sur laquelle reposera la suppression de `processed/`.
2. **Structure** — EOCD (et ZIP64 EOCD + locator si saturé) parsables, central directory parcourable, puis pour chaque entrée : signature et nom relus **au `localHeaderOffset` annoncé**, **les 12 octets patchés du LFH comparés au CD** (attrape un pwrite off-by-N sur n'importe quelle entrée, pour un coût d'I/O négligeable), et **contiguïté** : `offset[i] + 30 + nameBytesLen[i] + compressedSize[i] === offset[i+1]`, le dernier tombant exactement sur `cdOffset`.
3. **Données** — `crcMode: "spot" | "full"`. `"spot"` (utilisé aujourd'hui) inflate et recalcule le CRC de 3 entrées représentatives (première, milieu, dernière). `"full"` fait toutes les entrées, pour le futur flow destructif où une corruption non détectée devient irréversible. **Attention au faux-semblant** : le mode existe côté typage, mais `verifyZipArchive` n'a ni `AbortSignal` ni progression. En `full` sur 10–20 Go, la TUI resterait figée plusieurs minutes, Ctrl+C mort. Activer `full` suppose donc aussi : signal propagé, progression émise, et un état de vérification distinct dans la machine à états — pas juste un mot.

Échec de n'importe quelle couche → `verify-failed`, `.tmp` supprimé, rien dans `archived/`.

### Série de volumes (Phase 9)

Le portail Vigie-Chiro refuse le ZIP64. Le zip unique de la Phase 8 est donc **indéposable** sur des volumes réels, et c'est le dépôt qui est la finalité de l'outil. `createZipVolumes` (`src/lib/archive/createZipVolumes.ts`) produit en plus une série de zips de 3,5 Gio, chacun **prouvé** sans ZIP64, publiée dans `upload/`. Le gros zip reste, pour la sauvegarde.

#### Bascule dynamique sur la taille réelle, pas pré-partitionnement

La décision structurante. Découper le lot **en amont** sur 3,5 Go de données _sources_ aurait produit des zips remplis au tiers (~1,1 Go) et 9 fichiers là où 3 suffisent, puisque le WAV ultrasonique compresse à ~36 %.

À la place, `createZipArchive` gagne une option `maxBytes` : **avant** d'écrire chaque entrée, il compare `currentOffset` — la taille **réellement** accumulée sur le disque, compression comprise, plus les enregistrements de central directory déjà construits et la taille de l'EOCD — au plafond. Si l'entrée n'y tiendrait pas, il clôt proprement le volume (même `finalize` que la fin nominale, donc mêmes vérifications) et retourne `{kind:"volume-full", entriesWritten}`. L'orchestrateur reprend à l'entrée suivante dans un nouveau volume.

La garantie « jamais ZIP64 » est ainsi **stricte** : `currentOffset` est la vérité du disque, jamais une estimation. La borne de compression (§ suivant) ne sert qu'à décider si la _prochaine_ entrée tient — s'y tromper coûte au pire un volume légèrement moins rempli, jamais un dépassement. La première entrée d'un volume passe toujours, quel que soit le plafond (une entrée seule plus grosse que le plafond est hors périmètre : les fichiers découpés font quelques Mo).

Conséquences assumées, toutes visibles dans l'UI :

- **Le nombre total de volumes est inconnu pendant le run.** `RunningView` affiche `Fichier zip 3` sans total (et masque la ligne tant qu'on est sur le premier volume, pour ne pas afficher un « Fichier zip 1 » absurde sur le cas mono-volume). La barre, elle, reste exacte : elle est pilotée par les octets **sources**, tous connus d'avance.
- **Les noms définitifs `partN` sont attribués au commit**, quand N est enfin connu — gratuit, tout est déjà dans le staging sous des noms provisoires `volume-N.zip`.

#### Borne de compression conservatrice

`deflateBound.ts` n'utilise **pas** la borne serrée de zlib (`n + (n>>12) + (n>>14) + (n>>25) + 13`). Vérifié empiriquement sur le `deflateRaw` de Bun, 10 configurations : cette formule n'est valide que pour `level ∈ {2..9}` **et** `windowBits: 15` **et** `memLevel: 8`. Elle est dépassée par `level: 1` (+456 Ko sur 8 Mio), `memLevel: 1`, `windowBits: 9` et leurs combinaisons — et le piège est concret, `level: 1` a été proposé en cours de session pour accélérer la compression.

On utilise la borne **inconditionnelle** `n + ⌈(n+7)/8⌉ + ⌈(n+63)/64⌉ + 5` (+14 %), qui tient sur les 10 configurations, y compris les pires combinaisons. Son surcoût est sans effet ici puisqu'elle ne sert qu'à décider si la prochaine entrée tient : au pire un volume finit 14 % moins rempli sur sa dernière entrée, soit quelques mégaoctets. On échange une optimisation invisible contre l'immunité à toute une classe de régressions silencieuses. **Ne pas « optimiser » vers la formule serrée, et ne pas changer les options de `createDeflateRaw` sans re-vérifier.**

`nameBytes` est toujours la longueur **en octets UTF-8** (`nameBytesOf`), jamais `String.length` — même règle que partout dans le module.

#### Garde-fou `zip64: "forbid"`

Le partitionnement empêche, le garde-fou **prouve**. Mode en chaîne plutôt que booléen négatif, cohérent avec `crcMode`. Trois points, du moins cher au plus tardif :

1. **Garde 0**, en tête d'appel : `entries.length >= entryCountThreshold` → échec en millisecondes. C'est le seul déclencheur que le garde par entrée ne voit jamais. **Piège** : ce garde est **désactivé quand `maxBytes` est posé** — sous bascule dynamique, `opts.entries` est le lot _restant_ confié au volume, pas ce que ce volume écrira ; le comparer au seuil ferait échouer tout le flux de dépôt dès le premier `processed/` réel. Le contrôle est refait **par volume** dans la boucle d'admission (`cdRecords.length + 1 >= entryCountThreshold`), où le compte est celui du volume courant.
2. Dans la boucle, juste après `const localHeaderOffset = currentOffset;` — échoue avant d'écrire le local file header.
3. **Avant** la boucle d'écriture du central directory : `cdOffset` et `cdSize` y sont déjà connus, autant ne rien écrire quand on sait qu'on ne peut pas finir.

Code `zip64-required`, chemin `failWith` existant donc `.tmp` unlinké. **Le flux sauvegarde ne pose pas le mode `forbid`** : ZIP64 y reste nominal. Le **câblage** est testé, pas seulement le garde : `createZipVolumes` forwarde `zip64Thresholds`, et un test l'appelle avec `{offset: 64}` en attendant `zip64-required` **et** un `upload/` vide. C'est le seul test qui rougit si l'assignation `zip64: "forbid"` saute lors d'un refactor.

#### ADR — un dossier de staging plutôt que N renames

```
upload/.Car340581-2026-Pass1-A1_20260814.<pid>.tmpdir/   ← volumes écrits + vérifiés ici
        ↓ un rename(2), même parent donc jamais EXDEV
upload/Car340581-2026-Pass1-A1_20260814/                 ← apparaît d'un coup, complet
    ├── Car340581-2026-Pass1-A1_20260814_part1.zip
    ├── Car340581-2026-Pass1-A1_20260814_part2.zip
    └── Car340581-2026-Pass1-A1_20260814_part3.zip
```

**Option retenue** : un staging caché, publié par **un seul `rename`**. Commit en 1 syscall — aucune fenêtre pendant laquelle `upload/` contient une série à moitié écrite, ce qui est exactement ce que promet l'écran (« Les fichiers zip n'y apparaîtront qu'à la toute fin, tous ensemble »). Un dossier daté par run supprime au passage l'ambiguïté « lesquels dois-je déposer ? » quand un dépôt précédent traîne. **Option écartée** : renommer les N volumes un par un dans `upload/` en fin de run — N fenêtres d'incohérence, et une série partielle indiscernable d'une série complète pour l'utilisatrice.

Détails qui ne sont pas des détails :

- **La collision se résout au commit, en boucle**, jamais à l'aperçu. `rename(2)` sur un répertoire cible non vide échoue `ENOTEMPTY` (il n'écrase pas, contrairement au cas fichier) : deux terminaux lancés le même jour verraient sinon le second perdre 15 minutes de calcul. La boucle consomme `collisionNameCandidates` (`-2`..`-99`, la même source que le flux sauvegarde), puis `collision-exhausted`.
- **`rename` nu**, jamais `renameWithFallback` : son repli EXDEV fait un `copyFile`, structurellement faux sur un répertoire.
- **Suffixe `.tmpdir`, pas `.tmp`** : `ORPHAN_TMP_REGEX` (`createZipArchive.ts`) matcherait `.tmp` et appellerait `unlink()` sur un répertoire — échec avalé par le `.catch()`, nettoyage silencieusement inopérant.
- **Nom de volume dérivé du nom _avant_ collision** : `buildVolumeFileName` reçoit le `seriesDirName` d'origine, pas le nom finalement committé (qui peut porter `-2`). Le dossier porte la distinction, les fichiers n'ont pas à la répéter.

#### Nettoyage des staging orphelins

`cleanOrphanStagingDirs(uploadDir)` est appelé **au constat** — l'écran affiche déjà « Analyse du dossier… » — jamais au run, où il figerait l'UI juste après l'Entrée.

- Seules les entrées **directes** de `upload/` matchant `^\.(.+)\.(\d+)\.tmpdir$` sont candidates, `lstat` + `isDirectory()` (ne jamais suivre un lien).
- **Liveness PID _plus_ garde d'âge (> 24 h)** : les PID sont recyclés ; un `kill -9` suivi d'une réattribution laisserait sinon un dossier **caché de plusieurs Go** que l'utilisatrice ne voit ni ne comprend. Un `EPERM` sur `process.kill(pid, 0)` compte comme « vivant » (process d'un autre utilisateur).
- **Suppression fichier par fichier des seuls noms attendus** (`*.zip`, `*.tmp`) puis `rmdir` — **jamais `recursive: true`**. C'est la première suppression de répertoire du module, sur un chemin dérivé du dossier de l'utilisatrice. Un `ENOTEMPTY` au `rmdir` fait renoncer plutôt qu'écraser du contenu inconnu.
- Best-effort de bout en bout : aucune erreur ne remonte à l'appelant.

Le staging du run **en cours**, lui, est détruit par `rm(recursive, force)` sur tout chemin de sortie non-`ok` (abort, erreur, complétude en échec) : ici le chemin vient d'être fabriqué par le module lui-même dans la même fonction, il n'y a pas d'inconnu à protéger.

#### Complétude de la série

`createZipArchive` ancre déjà la complétude sur les entrées _demandées par l'appelant_, sans quoi la vérification serait auto-référentielle. La série reproduit le problème d'un cran plus haut : chaque volume vérifie sa propre tranche contre sa propre tranche, et **rien ne vérifierait que l'union des tranches couvre la source**. C'est pourtant la série qui porte la promesse « déposez ces fichiers, vous avez tout », et c'est sur elle que s'appuiera la future suppression de `processed/`.

Avant le commit : somme des `entryCount` retournés par chaque volume `===` `entries.length`, **et** égalité ensembliste des noms contre l'entrée. Échec → staging détruit, `verify-failed`. Quelques lignes.

Cette garde est **inatteignable par l'API publique tant que le writer est correct** — c'est pourquoi elle est restée sans test jusqu'à la revue post-implémentation, qui l'a désactivée par mutation sans faire rougir un seul des 244 tests. Elle est désormais couverte par `createZipVolumesCompleteness.test.ts`, qui mocke `createZipArchive` pour qu'il mente sur ses comptes, avec un contrôle positif à côté (sans lui, on ne saurait pas distinguer « la garde discrimine » de « la garde refuse tout »).

#### Complétude dans l'autre sens : aucun fichier en trop

La garde ci-dessus prouve qu'aucune entrée ne manque. Elle ne dit rien de la réciproque, et le commit publie le répertoire **en bloc** : tout ce qui s'y trouve part avec la série.

Deux verrous, tous deux nécessaires :

- **`mkdir(staging)` sans `recursive`.** Le nom du staging ne dépend que de la série et de notre propre PID : il est donc identique d'une tentative à l'autre dans le même processus — et `cleanOrphanStagingDirs` exempte précisément les PID vivants, dont le nôtre. Avec `recursive: true`, un reliquat d'une tentative ratée (dont le nettoyage est best-effort) ou d'un processus mort dont le PID a été réattribué était **adopté en silence**. Sur `EEXIST` on détruit le reliquat et on recrée : échouer franchement casserait un réessai légitime.
- **`readdir` du staging comparé aux volumes réellement produits, juste avant le commit.** Ancré sur le répertoire, jamais sur ce que la boucle croit avoir écrit. C'est le filet qui attrape tout ce que le premier verrou ne prévoit pas.

Sans eux, une série annoncée à deux fichiers pouvait en publier quatre, dont un `<série>_part9.zip` parfaitement valide issu d'un run précédent — indiscernable d'un vrai une fois déposé sur le portail. Les deux verrous sont couverts par des tests vérifiés par mutation (`createZipVolumes.test.ts`, § « staging residue »).

#### Progression en coordonnées globales

`ArchiveProgressEvent` **ne change pas**. `createZipVolumes` enveloppe le `onProgress` de chaque volume et réécrit `entryIndex` / `totalBytesRead` en coordonnées **globales** : la base est la somme des tailles _planifiées_ des volumes déjà clos, jamais « le dernier `totalBytesRead` observé » (qui se remet à zéro au volume suivant et provoquerait un double comptage). Un seul événement supplémentaire, `{kind:"volume-start", volumeIndex}`, déclaré dans `createZipVolumes.ts` et pas dans le writer — qui ne l'émet jamais.

Ça fonctionne sans toucher au hook parce que `useArchiveProgressState` **ignore `event.totalEntries`** et lit `entries.length` de ses props. C'est écrit dans le code : quelqu'un qui « corrigerait » le ré-offset en propageant `totalEntries` casserait l'affichage. La chaîne if/else du hook est devenue un `switch` exhaustif avec garde `never`.

#### `fsync` de répertoire (dette Phase 8 soldée)

Un `fsync` de fichier rend son _contenu_ durable, mais le `rename` final modifie le **répertoire**, dont l'entrée peut rester en cache. Après une coupure de courant, on peut donc avoir les octets sur le disque sans que le dossier sache qu'ils s'appellent `…zip`. Mesuré : **0,12 ms** (0,07 ms sur `/usr/bin`, très peuplé) — le coût est nul, la dette est soldée.

- `createZipArchive` : `fsync` du répertoire parent après son rename final.
- `createZipVolumes` : `fsync` du staging **avant** de le renommer (rend durables les noms des volumes qu'il contient), puis `fsync` d'`upload/` après le rename. Deux appels pour toute la série.
- **Best-effort, remonté dans le Result** (`durable: boolean`) plutôt qu'échec du run : le zip est valide et renommé, faire échouer serait absurde. Mais le futur flux destructif devra exiger `durable === true` avant de supprimer quoi que ce soit — c'est exactement ce que demandait la précondition n° 2 de `roadmap.md`, désormais levée.

### Invariants

- **Non-destructivité structurelle** : aucun `unlink`, `rename` ou `write` sur un chemin sous `processed/` dans tout le module. Les seules écritures vivent dans les répertoires de sortie — `archived/` (le `.tmp`, puis son rename) et `upload/` (le staging `.tmpdir`, ses volumes, puis le rename de commit). Depuis la Phase 9 le module **supprime** des choses (staging du run, staging orphelins), mais uniquement des chemins qu'il a lui-même fabriqués sous `upload/`, jamais une entrée de `processed/` : c'est cette frontière-là que le module garantit, pas « aucune suppression ». Même construction que `processWavFiles` (§ « Non-destructivité — invariants garantis »).
- **No-throw** : toutes les fonctions publiques rendent un Result tagué (`ok` / `aborted` / `error(code)`). Les codes bruts restent dans `lib/` ; la traduction française vit dans `screens/archive/errorMessages.ts`, adossé au `fsErrorMessages.ts` partagé.
- **Filtre d'admission unique** : `isVisibleNonTmpEntry` est exporté par `scanDirectory.ts` et consommé à la fois par `checkProcessedDirConflict` (flow Découper) et `scanProcessedForArchive`. Une divergence entre « ce que le découpage considère comme un `processed/` peuplé » et « ce que le zip embarque » serait structurellement invisible en review — même raisonnement que l'extraction de `batchPlan`.
- **TOCTOU borné** : chaque entrée est re-`stat`ée **juste avant** son `open()`, et un écart entre la taille attendue et les octets réellement lus donne `file-changed`. La fenêtre passe de « scan → run » (minutes) à quelques microsecondes.
- **AbortSignal** propagé jusque dans la boucle de lecture (vérifié à chaque bloc de 1 Mio), cleanup du `.tmp` sur abort.

### Limites connues et acceptées

- **Symlinks silencieusement exclus** : le scan filtre sur `Dirent.isFile()`, faux pour un lien. Un `processed/` peuplé de liens produirait un zip vide sans explication. Cas jugé inexistant chez la cible (le dossier est produit par chiro lui-même) ; à traiter si un usage avancé émerge.
- **Deux instances de chiro dans le même dossier le même jour** (le nom est daté au jour depuis la Phase 9, plus à la minute) : les `.tmp` sont distincts (PID), mais côté **sauvegarde** les deux runs résolvent le même nom final libre et le second `rename` peut écraser le premier zip. Accepté : non-destructif pour `processed/`, et le scénario suppose deux terminaux sur le même dossier. Côté **dépôt**, ce cas est couvert : la collision est résolue au commit, par un vrai `rename` en boucle, pas par un pré-test d'existence.
- **`fsync` du répertoire de sortie : fait** depuis la Phase 9 (§ « `fsync` de répertoire »), dans les deux flux, best-effort et remonté en `durable`. La précondition correspondante de la suppression de `processed/` est levée.
- **Vérification en mode `spot`** : une corruption isolée au milieu d'une entrée non échantillonnée passerait le contrôle de CRC (elle serait tout de même attrapée par les contrôles structurels et de contiguïté). `crcMode: "full"` est la réponse, à activer en même temps que le flow destructif.
- **Noms accentués : le writer est fidèle, les extracteurs macOS ne le sont pas.** Le nom est écrit avec les octets UTF-8 exacts renvoyés par `readdir` et le flag `0x0800` est posé — vérifié : Python relit `'été_000.wav'` à l'identique, contenu compris. En revanche l'`unzip` livré par Apple (Info-ZIP 6.00, 2009) ignore ce flag et échoue à extraire un tel nom, et `bsdtar` le renormalise en NFD à l'extraction (le nom extrait diffère alors octet à octet de l'original, à l'œil il est identique). Rien à corriger côté chiro, et sans effet en pratique : les noms produits par le flow de préfixage sont purement ASCII (`Car340581-2026-Pass1-A1-PaRec…`). À garder en tête si un jour un point d'écoute accentué devient possible.
- **`--self-test` n'est volontairement pas étendu au zip.** Ce flag existe pour prouver ce que seul le **binaire compilé** peut casser : résolution d'asset dans `/$bunfs/`, worker bundlé, rendu Ink non-interactif. Le module archive n'a ni asset embarqué ni worker — il n'exerce aucun de ces pièges, et sa couverture unitaire (dont trois extracteurs réels) est bien plus forte. Ne pas l'y ajouter « par symétrie » : ça allongerait la CI sans rien tester de plus.

### Tests

- **Purs** : `crc32` (vecteur `"123456789"` → `0xCBF43926`, incrémental ≡ one-shot) ; `zipFormat` octet par octet (tailles fixes, saturation par champ, `versionNeeded` conditionnel, `toDosDateTime` sur 1979 / 1980 / 2107 / 2108 / `NaN`) ; `planArchive` (filtres, tri, collisions) ; `planUpload` (nommage daté, cas N=1 sans suffixe, zéro-padding au-delà de 9 volumes et tri lexicographique correct, `.tmpdir` jamais `.tmp`) ; `deflateBound` ; `maxVolumeBytes` sur entrées hostiles (`"999999999999"`, `"abc"`, `"-1"`, notation scientifique) — la propriété testée est « le résultat reste strictement sous `MAX_UINT32` pour **toute** entrée ».
- **Round-trip** : un reader de test (`__tests__/zipTestReader.ts`, parse du CD + `inflateRaw`) compare les octets restitués aux sources. Fixtures : nominal, nom accentué NFC **et** NFD, fichier de taille 0, abort en cours de run (aucun `.tmp` résiduel), `file-changed`, séquence de progression, `verify-failed` sur un zip volontairement mutilé (via le hook `corruptBeforeVerifyForTests`, seam explicite plutôt que mock du système de fichiers).
- **ZIP64** : seuils injectés, bout en bout, validé par `unzip -t`.
- **Absence de ZIP64 — « la preuve »** (`noZip64.test.ts`) : 40 entrées volontairement **incompressibles** (digests SHA-256 enchaînés — du WAV compresserait et masquerait tout) découpées en plusieurs volumes sous `maxBytes`. Pour chaque volume : `versionNeeded === 20` partout, `extraLength === 0`, ni ZIP64 EOCD ni locator — détecté **structurellement** (les 20 octets qui précèdent l'EOCD), **jamais** par recherche de signature, un flux deflate pouvant contenir `50 4B 06 06`. Plus l'égalité stricte du layout et l'union des entrées = ensemble source exactement.
- **Série** (`createZipVolumes.test.ts`) : nominal, cas N=1 sans suffixe `part`, atomicité (abort ou fichier disparu → `upload/` **vide**), câblage `zip64Thresholds` → `zip64-required` + `upload/` vide, collision au commit → `-2`, ré-offset de progression (un `volume-start` par volume, `entryIndex` globalement monotone, `bytes-read` final = total), et `cleanOrphanStagingDirs` (PID vivant/mort, garde d'âge 24 h, symlink jamais suivi, `ENOTEMPTY` → renoncement).
- **Golden** : contenus, `mtime` et date figés, `TZ` épinglé via `vi.stubEnv` — les timestamps DOS sont en heure locale, sans quoi le test passerait en France et échouerait sur un runner en UTC.
- **Extracteurs réels** (`externalTools.test.ts`) : `unzip -t`, `python3 -m zipfile -t`, `bsdtar -tf` — trois implémentations indépendantes. Skip silencieux si l'outil manque en local, **échec dur si absent en CI** (un skip silencieux sur un runner serait une couverture fantôme).

## Module `lib/offsite` (Phase 10)

Envoie `archived/<préfixe>_YYYYMMDD.zip` (la copie de sauvegarde du § « Module `lib/archive` » ci-dessus, jamais la série de dépôt) vers un bucket Scaleway Object Storage en classe `GLACIER`, via `rclone`. C'est une **capacité optionnelle** au sens de la table § « Les trois statuts possibles d'un binaire externe » plus haut — absente, l'utilisatrice ne perd rien de ce dont elle a besoin, le zip local suffit. Comportement fonctionnel dans `spec.md` § « Wizard "Archiver la sauvegarde en ligne" », wordings dans `ux.md` § « Flow "Archiver la sauvegarde en ligne" ». Cette section documente le **comment** et le **pourquoi**.

### Arborescence

```
src/lib/offsite/
  settings.ts                 # lecture + validation de ~/.chiro/settings.json (clé "coffre")
  detectRclone.ts              # sonde synchrone : PATH + version >= 1.53 (plancher de `lsjson --stat`)
  resolveOffsiteAvailability.ts# combine detectRclone + loadOffsiteSettings en un yes/no unique
  powerState.ts                # pmset -g batt (darwin only) -> "ac" | "battery" | "unknown"
  pickArchiveToUpload.ts       # le plus récent par mtime dans archived/, + compte des autres
  remoteStat.ts                # lsjson --stat -> present{bytes,modTime,tier} | absent | error
  buildRcloneCommand.ts        # pure : préfixe caffeinate sur darwin
  parseRcloneStats.ts          # pure : ligne stderr JSON -> tick | null, + reader incrémental
  uploadArchive.ts             # spawn injecté, progression, SIGINT + escalade, vérification post-transfert
  estimatedDuration.ts         # taille -> durée affichée, calibrée sur un débit pessimiste
src/lib/logging/
  buildOffsiteSessionEvent.ts  # construit l'entrée schema_version 6 (action "vigie-upload")
src/screens/offsite/
  ConstatScreen.tsx    ConfirmScreen.tsx   RunScreen.tsx   RunningView.tsx   ResultScreen.tsx
  useOffsiteRun.ts     useOffsiteProgressState.ts   errorMessages.ts
```

`resolveOffsiteAvailability` est le seul point qui décide si la porte est montrée : `rclone.kind !== "available"` **ou** `settingsResult.kind !== "ok"` → `{ kind: "unavailable" }`, sans distinguer laquelle des deux causes — `docs/ux.md` est explicite que cette dégradation est **totalement silencieuse**, aucun message nulle part. Un bucket/remote mal configuré alors que le JSON est bien formé surface plus tard, sur l'écran de constat, quand l'utilisatrice tente réellement d'archiver (`bucket-missing` / `config-error` via `remoteStat`).

`RunScreen.tsx` est la pièce de connexion que le plan de la Phase 10 n'avait pas nommée mais que l'architecture impose : `ConfirmScreen.tsx` a été livré en 10.B1 comme une vue de confirmation sans état, avec ses propres tests, et le plan liste `RunningView`/`ResultScreen`/`useOffsiteRun` comme des fichiers séparés plutôt qu'une machine à états repliée dans la confirmation (contrairement aux trois autres flows, où confirmation et run partagent un seul fichier). `RunScreen` joue pour ce flow le rôle que `archive/ConfirmScreen.tsx` joue pour le sien : porter le cycle de vie de `useOffsiteRun` (montage → démarrage, abandon au démontage) attaché à un composant qui monte et démonte réellement avec la navigation.

### Contrat de progression — chiffres mesurés

Le PoC de 10.0 avait validé, sur une copie locale **sans erreur**, que `bytes` est monotone et `totalBytes` connu dès le premier tick. Reproduit avec un échec en cours de transfert (rclone 1.75, fichier de 209 715 200 octets, `--retries 3`, trace committée dans `test-data/rclone-stats/copy-with-retry.jsonl`), trois choses cassent ensemble :

- **`totalBytes` n'est jamais la taille de l'objet.** Sur cette trace il va 240 447 488 → 271 179 776 → 92 196 864 pour un fichier de 209 715 200 octets — « octets déjà comptés + reste de la tentative en cours », un dénominateur mobile. Et sur le chemin **nominal** (`test-data/rclone-stats/upload-1gb-nominal.jsonl`), il vaut **`0`** sur les deux premiers ticks : une division brute plante ou donne `Infinity` dès le démarrage.
- **`bytes` cumule les octets réémis.** 63 Mo pour un fichier qui n'a jamais dépassé ~21 Mo de progression réelle sur la trace de retry.
- **Sur le tick final d'un transfert qui a échoué, `bytes / totalBytes` vaut exactement `1,0`** (`errors: 1`) — une barre bâtie dessus afficherait 100 % sur une erreur. Et `stats.transferring` est **vide sur le tick final**, dans tous les cas, ce qui interdit d'en faire l'unique source.

**Correction, qui simplifie plutôt qu'elle ne complique** : chiro connaît déjà le dénominateur, il a `stat`é le zip pour le choisir.

- `bytesTotal` = **taille locale du fichier**, jamais `totalBytes` de rclone (`parseRcloneStats.ts` ne le lit nulle part — omission volontaire, documentée dans le code pour qu'un futur lecteur ne la « corrige » pas).
- Numérateur = `stats.transferring[0]?.bytes ?? stats.bytes`, **clampé monotone** (`shown = Math.max(shown, tick)` dans `uploadArchive.ts`) : un retry qui fait reculer les compteurs de rclone ne fait jamais reculer la barre affichée.
- L'`eta` de rclone est ignoré partout — les cinq flux de l'app estiment de la même façon, via `etaTracker`.
- **Décrochage réseau** : au-delà de 60 s sans le moindre octet de progrès, `useOffsiteProgressState` bascule en `stalled`, l'ETA repasse à `null` (jamais une estimation calculée sur une fenêtre où rien n'a bougé) et `RunningView` affiche une ligne `⚠` jaune via la prop `noticeLine` de `ProgressPanel` — même argument que l'écran « Annulation en cours… » de la Phase 9 : un écran figé est indiscernable d'un plantage.

Fixtures réelles dans `test-data/rclone-stats/` (README dédié) : capturées le 17/08/2026 sur rclone v1.75.0, rejouées octet pour octet **et** à des tailles de chunk adverses (1, 7, 4096 octets) pour couvrir le découpage arbitraire d'un flux stdout, UTF-8 compris — un faux rclone écrit à la main est authored depuis le même modèle mental que le parseur qu'il nourrit, et les deux peuvent se tromper ensemble ; c'est exactement ce qui s'est passé avec ce contrat de progression, mesuré comme faux après avoir été supposé vrai sur le seul chemin heureux.

### Le piège `IsDir`

`remoteStat` (`lsjson --stat`) discrimine sur `record.IsDir`, **jamais sur le code de sortie seul**. Mesuré sur le vrai bucket, le 17/08/2026, rclone v1.75.0 :

| cas                | code  | forme                                                |
| ------------------ | ----- | ---------------------------------------------------- |
| objet présent      | 0     | `{"IsDir": false, "Size": N, "Tier": "..."}`         |
| **objet absent**   | **0** | `{"IsDir": true, "Size": -1}` — un pseudo-répertoire |
| bucket introuvable | 3     | `Failed to lsjson: directory not found`              |
| remote inconnu     | 1     | `didn't find section in config file`                 |

Un objet absent sort en **code 0** — un parseur qui lirait `Size` sur tout exit 0 conclurait « présent, taille -1 », la lecture la plus dangereuse possible ici puisqu'elle est sur le chemin **nominal** (le tout premier archivage d'une étude passe systématiquement par ce cas). `remoteStat` traite `IsDir === true` comme `{ kind: "absent" }`, `IsDir === false` comme `{ kind: "present" }`, et n'importe quelle autre forme comme `unparseable-lsjson`. Code 3 → `bucket-missing`, code 1 → `config-error` : les trois cas restent distincts, contrairement à ce qu'une lecture rapide du plan initial avait craint.

### Séquence SIGINT et la course

Mesuré : `kill -INT` sur rclone → `exit=130`, retour en ~0,16 s, **aucun tick final** (rclone gère lui-même le signal et ne le reporte jamais dans `signal`, qui reste `null` côté Node). `uploadArchive` détecte donc l'abandon par son **propre drapeau d'intention**, jamais par la forme de sortie du process.

**Escalade automatique, bornée** : `signal` déclenche un SIGINT immédiat ; un second SIGINT après `sigintResendMs` (5 s par défaut) au cas où le premier a été perdu ou ignoré ; un SIGKILL dur après `killEscalationMs` (15 s). SIGINT plutôt qu'un SIGKILL d'emblée : un SIGKILL laisse les parts multipart en vol, **facturées**, sans que rien ne les abandonne ; un SIGINT donne à rclone la chance de les nettoyer lui-même. Vérifié à la main le 17/08/2026 : après un Ctrl+C en plein transfert, `rclone backend list-multipart-uploads` revient **vide** — le SIGINT fait bien abandonner les parts.

**La course qui ne doit pas se perdre** : rclone peut sortir `0` dans la fenêtre entre la demande d'abandon et l'arrivée effective du signal — l'objet est alors réellement dans le bucket (rclone a pu sortir « proprement » avant que le SIGINT ne l'atteigne). `uploadArchive` consulte donc **quand même** le code de sortie après un abandon : `0` reste un succès, exactement comme sur le chemin non-abandonné. Annoncer « annulé » et ne rien journaliser ferait re-proposer l'envoi complet d'un objet multi-Go déjà présent — et, sur AWS, des frais de suppression anticipée en prime (Scaleway n'en a pas, cf. § tarification plus bas, mais l'objet resterait double).

### `caffeinate` en préfixe, jamais un process séparé

`buildRcloneCommand` (pure, testable sans rien spawner) préfixe `caffeinate -i -s` devant la commande rclone sur darwin, plutôt que de spawner un second process `caffeinate` indépendant. Un `spawn("caffeinate", [...])` séparé **survivrait à un `kill -9` de chiro**, un crash, ou la fermeture du terminal — le Mac ne se mettrait alors plus jamais en veille, invisiblement, jusqu'au prochain redémarrage, sans que rien dans chiro puisse le détecter ou l'expliquer. Préfixé, `caffeinate` est le **parent** de rclone : il meurt avec son enfant par construction, aucun cycle de vie à gérer, aucun orphelin possible.

`-i` inhibe la veille par inactivité, `-s` la veille système — mais **`-s` n'a d'effet que sur secteur**, le manuel de `caffeinate` le dit noir sur blanc (« valid only when system is running on AC power »). C'est pourquoi `readPowerState` (`pmset -g batt`) n'est pas redondant avec `caffeinate` : sur batterie, l'inhibition la plus forte que chiro puisse demander ne fait rien, et seule la phrase à l'écran de `O-Confirmation` protège le run. **Ni `-i` ni `-s` ne couvrent la fermeture du capot** — aucune ligne de code ne le peut, c'est précisément le geste naturel de « je lance et je vais dormir » ; seule la puce de l'écran de confirmation le mentionne. `readPowerState` est darwin-only par construction (la cible est un Mac) : `unknown` sur toute autre plateforme, tout `pmset` non reconnu, ou tout échec de spawn — rester silencieux y est plus sûr que de crier au loup sur une lecture dont chiro n'est pas sûr.

### Pourquoi `useOffsiteRun` est distinct de `useArchiveRun`

`useArchiveRun` (§ « Module `lib/archive` » ci-dessus) est déjà générique sur `TOk` : la forme du succès n'a **jamais** été l'obstacle à sa réutilisation ici — `OffsiteRunOkOutcome` aurait pu être un troisième `TOk`. Les vrais obstacles sont ailleurs :

- `entries`/`totalBytes` sont inscrits **à la fois** dans les options du hook et dans la signature du runner qu'il appelle (`ArchiveRunner<TOk>`) — l'offsite n'a ni liste d'entrées ni total d'octets à faire circuler, un seul fichier et sa taille déjà connue.
- `VolumeProgressEvent` est figé dans le type d'`onProgress` — l'offsite reçoit un simple `bytesTransferred: number` par tick, une forme incompatible sans union supplémentaire.
- `resolveTargetName` veut dire « calculer un nom **à créer** » (résolution de collision `-2`…`-99`) — l'offsite a besoin de l'inverse, « vérifier qu'un fichier **existe déjà** en distant » (`remoteStat`), une opération de nature différente, pas juste un nom différent.

Généraliser `useArchiveRun` aurait coûté trois paramètres de type de plus et un résolveur optionnel, sur un hook qui n'aurait alors plus que deux appelants réels (`backupBehavior`/`packageBehavior`) plus ce troisième cas structurellement différent. `useOffsiteRun` est donc écrit séparément — décision documentée ici pour qu'un futur lecteur qui verrait la ressemblance de surface (spawn, progression, abandon, log) ne (re)tente pas la fusion sans relire ces trois obstacles.

**C'est la troisième copie du couple `AbortController` + `runningRef` + latch de démarrage synchrone + `cancelled`**, après `useArchiveRun` et `useVigieProcessRun`. La Règle de Trois dirait d'extraire — **décision volontaire de ne pas le faire** : l'extraction représente environ huit lignes de refs, et les trois contextes qui les entourent diffèrent partout ailleurs (un `retry()` propre à l'offsite, un état `cleaning` propre à la série de volumes, aucun équivalent dans le flow rename). Consigné ici pour que la phase suivante ne re-litige pas ce choix sans avoir vu cette note.

### L'exception à la 3ᵉ condition de l'ADR

L'écran `O-Constat` « taille différente » **remplace réellement** l'objet distant sur `Entrée` : un `PUT` sur une clé existante détruit la copie précédente (le bucket n'a pas le versioning activé), sur la seule foi de ce que `rclone lsjson` a répondu. C'est très exactement la forme que la 3ᵉ condition du § « Les trois statuts possibles d'un binaire externe » refuse (« aucune action destructive n'est conditionnée à son auto-déclaration »).

**Décision utilisateur assumée, prise contre l'avis de l'architecte** — écrite ici comme une exception explicite plutôt que laissée en contradiction silencieuse avec l'ADR. Motif : un seul objet par nuit dans le coffre, jamais de doublon périmé qu'il faudrait départager dans trois ans sans indice. Le cas ne survient d'ailleurs que si le zip local a été **refait** sous le même nom (un second passage, un re-découpage) — l'objet distant est alors, par construction, une version antérieure du même contenu.

**Ce qui borne l'exception, et qui ne s'étend pas par précédent** : elle porte sur le **seul objet distant du même nom**, jamais sur `processed/`, jamais sur `archived/` — les deux zips (local et distant) restent chacun ce qu'ils étaient avant que `Entrée` ne soit pressé, sauf l'objet distant lui-même. Le fait qui la rend défendable, et qui doit être écrit sans le déformer : **un transfert interrompu ne laisse jamais aucun objet visible** dans le bucket (le multipart n'est jamais commité tant que la dernière part n'est pas envoyée). Un objet présent de taille différente n'est donc jamais un envoi **tronqué** — c'est nécessairement un envoi **complet**, d'un contenu qui a changé depuis. L'écran `O-Constat` le dit dans ces termes exacts (« C'est le signe que la sauvegarde a été refaite depuis. Le fichier en ligne est une version plus ancienne. ») et jamais en termes de fichier incomplet.

### `verify-absent` n'est pas `verify-unavailable`

La ligne de partage entre les deux est **épistémique**, pas de degré : `unavailable` (le champ `verified: "unavailable"`, une variante de **succès**) veut dire « chiro n'a pas eu de réponse » ; `verify-absent` (une **erreur**) veut dire « chiro a eu une réponse, et elle dit non ». Seule l'incertitude a le droit d'accompagner un succès.

La cause réaliste d'un `verify-absent` est une clé de bucket mal construite — écrire à un chemin, relire à un autre — dont c'est l'unique symptôme observable : le transfert a réussi selon rclone, mais l'objet qu'on cherche ensuite n'existe pas là où on le cherche. Classer ce cas en succès (« la vérification a juste échoué, tout va bien ») déguiserait un bug qui n'archive en réalité rien, tout en annonçant que tout va bien. L'asymétrie des coûts tranche : une fausse alerte (`verify-absent` sur un transfert en réalité réussi, très improbable vu la cohérence read-after-write de Scaleway comme de S3 depuis 2020) coûte un renvoi inutile ; un faux feu vert sur une fonction de sauvegarde se découvre des années plus tard, quand le coffre s'avère vide.

`verify-failed` (objet présent à une taille **différente** de celle envoyée) est la troisième issue de la vérification post-transfert — un désaccord entre deux tailles connues, plus directement actionnable que `verify-absent`, mais classée transitoire au même titre (`isTransientOffsiteError`) : rien ne reprend un multipart interrompu, donc dans les deux cas `Entrée` relance le transfert complet depuis le début.

### Ce qui n'est couvert par aucun test automatisé, et restera manuel

Cinq faits que seule une main peut vérifier contre le vrai service, jamais la CI :

- **Que le SIGINT fasse réellement abandonner les multiparts** — toute la justification de l'escalade SIGINT-avant-SIGKILL. **Vérifié à la main le 17/08/2026** : Ctrl+C en plein transfert, puis `rclone backend list-multipart-uploads` sur le bucket → liste vide.
- **Que `--s3-storage-class GLACIER` atterrisse bien en `GLACIER`.** **Vérifié à la main le 17/08/2026** : `Tier` relu par `lsjson --stat` sur l'objet écrit vaut `"GLACIER"`, sans transition de cycle de vie nécessaire — la classe est acceptée directement à l'écriture.
- **Le comportement de `lsjson --stat` sur un objet réel en classe Glacier.** **Vérifié à la main le 17/08/2026**, table du § « Le piège `IsDir` » ci-dessus — y compris que `Tier` est lisible **sans** l'option `-M`.
- **La durée de vie réelle de `caffeinate`** sur un run de plusieurs heures, capot fermé ou non.
- **L'absence de reprise multipart entre deux invocations rclone** (aucun flag `--s3-*resume*`) — reconfirmée en lisant la documentation de rclone 1.75, pas en la déclenchant réellement sur un vrai transfert coupé au milieu.

Les trois premiers ont une date et une méthode de vérification ; les deux derniers restent des affirmations de documentation/comportement observé indirectement. Aucun des cinq n'est exercé par `pnpm check` — l'écrire ici évite qu'un futur lecteur suppose que la CI les couvre.

### Tarification et cycle de vie Scaleway (mesuré le 17/08/2026)

- Stockage : 0,00254 €/Go/mois — 15 Go ≈ 0,46 €/an.
- **Aucune durée minimale de facturation, aucun frais de suppression anticipée** — contrairement aux 90 jours de S3 Glacier chez AWS. Remplacer un objet (§ exception ADR ci-dessus) ne coûte donc rien de plus que son stockage.
- Transfert entrant gratuit ; **requêtes API incluses** — le HEAD systématique du constat (`remoteStat`, à chaque ouverture de l'écran) ne facture rien.
- Restauration : 0,009 €/Go, délai **24 à 48 heures** (jamais « quelques heures » — corrigé dans le README après la mesure de 10.0, qui avait initialement une estimation plus optimiste). Egress : 75 Go/mois offerts puis 0,01 €/Go.

### Débit — calibration délibérément pessimiste

114 Mb/s soutenus mesurés sur 1 Gio depuis le réseau du développeur (⇒ 15 Go en ~19 min). Ce chiffre n'est **pas** celui utilisé pour l'estimation affichée : `estimatedDuration.ts` calibre `REFERENCE_UPLOAD_BYTES_PER_SECOND` à 30 Mb/s, délibérément pessimiste — un réseau domestique fait probablement moins bien qu'une mesure de développeur, et dépasser l'estimation affichée est la mauvaise direction (une archive qui finit plus tôt que prévu est une bonne surprise ; une qui prend le double du temps annoncé ne l'est pas). L'estimation reste **calculée depuis la taille du fichier**, jamais une valeur fixe — recalibrer après un premier archivage réel plutôt que par une nouvelle mesure isolée.

## Configuration (V2)

Pas de configuration utilisateur au MVP. En V2, `~/.config/chiro/last-session.json` stockera les derniers carré et code point pour pré-remplissage. À ne PAS implémenter au MVP.

## CI

Deux workflows GitHub Actions, plus `dependabot.yml` (deux écosystèmes : GitHub Actions en mensuel, npm en hebdo avec groupes `dev-tooling`/`runtime`/`react-major` et un `ignore` sur typescript ≥ 6.1 tant que le peer range de typescript-eslint bloque) :

- **`ci.yml`** : déclenché sur push (branche `main`) et pull_request.
  - Job `check` : `pnpm check`, matrice de 3 runs — `ubuntu-latest` sans sox, `ubuntu-latest` avec sox, `macos-latest` avec sox. `src/lib/` est pur TS/Node donc la variante **sans** sox ne tourne que sur Linux (le runner le moins cher) ; la variante **avec** sox tourne sur les deux OS car les versions de sox diffèrent entre apt et Homebrew et la cible utilisatrice est principalement macOS — une divergence sur le fast-path sox doit être détectée sur l'OS cible. Tests d'intégration sur fichiers réels `test-data/` → requiert `actions/checkout@v6` avec **`lfs: true`**. `bun` est pinné (`oven-sh/setup-bun@v2`, version `1.3.13`) pour rester aligné avec le bun qui construit les binaires de release.
  - Job `smoke-build` (matrix macOS arm64 + Linux x64, dépend de `check`) : compile le binaire puis exécute trois vérifications non-interactives :
    - `--version` : la sortie doit commencer par `chiro`.
    - `--help` : la sortie ne doit pas être vide.
    - `--self-test` : exécuté deux fois — une fois avec sox installé (doit produire la mention « byte-identique au pool », preuve que les deux pipelines produisent des chunks identiques), une fois avec `CHIRO_DISABLE_FASTPATH=1` (doit produire « sox : absent », forçant le chemin worker pool — celui qui dépend de la résolution d'asset `/$bunfs/` dans le binaire compilé). Cf. `src/lib/selftest/selfTest.ts`.
- **`release.yml`** : déclenché sur tag `v[0-9]+.[0-9]+.[0-9]+` (ou suffixe `-...`). 3 jobs :
  - `build-macos` / `build-linux` : réécrit `package.json` version depuis le tag → `pnpm install` → `pnpm check` complet (lint + typecheck + format + tests unitaires — **pas** de `lfs: true`, donc pas de sox ni de fixtures réelles ; gate plus faible que `ci.yml`, compensé par le fait que `check` doit déjà être passé sur la branche avant le tag) → build le binaire → vérifie que `--version` matche le tag → `--self-test` (variante worker pool uniquement, pas de sox sur les runners de release) → (macOS seulement) codesign ad-hoc → empaquette en tarball `.tar.gz` → upload artifact.
  - `release` : télécharge les deux artifacts, `gh release create` avec les deux tarballs ; passe `--prerelease` si le tag contient un `-` (ex. `v0.2.0-rc.1`), pour ne jamais promouvoir un tag de pré-release en "latest" (l'update check en dépend).

Note : le smoke test post-build TUI complet (golden path interactif) nécessiterait un PTY simulé (`script -q /dev/null`, `unbuffer`) — différé en V2. `--self-test` couvre la partie non-interactive critique (bundle wavefile, worker asset, byte-identité sox↔pool) sans nécessiter de PTY.

## Tests — stratégie

### Critiques (à écrire en Phase 1)

1. **`prefix.test.ts`** : tous les cas du format, dont :
   - Cas nominal `040962 / 2026 / 3 / A1` → `Car040962-2026-Pass3-A1-`
   - Département 1-9 padding : `06...` accepté, `6...` rejeté en validation
   - Point en minuscule normalisé (`a1` → `A1`)
   - Passage 1, 99, 100
2. **`isAlreadyPrefixed.test.ts`** : matche/ne matche pas la regex de la spec.
3. **`scanDirectory.test.ts`** : avec un dossier temporaire (`fs.mkdtemp`), vérifier filtre `.wav`/`.WAV`/dotfiles/dirs/symlinks + conflit `processed/` + somme de tailles.
4. **`planRenames.test.ts`** : idempotence, collisions sur disque, ordre alphabétique stable, casse `.WAV` → `.wav`.
5. **`applyRenames.test.ts`** : succès, fallback EXDEV simulé (mock `fs.rename` qui throw `EXDEV` → vérifier copyFile+unlink appelés), erreur partielle (un fichier renommé puis EACCES sur le suivant → résultat partiel cohérent).
6. **`e2e.test.ts`** : test round-trip complet — créer `mkdtemp` avec 10 fichiers variés (`.wav`, `.WAV`, déjà préfixé, accents, espaces, non-wav), invoquer le flux `scan → plan → apply`, asserter l'état final du disque.

### Best-effort (Phase 2)

- 1 parcours nominal Form → Confirm → Result via `ink-testing-library`. Pas de couverture exhaustive des écrans.

## Risques techniques à surveiller en Phase 0

1. **Bun + Ink 6 + React 19 + `bun --compile`** : combo non éprouvé publiquement. Si le binaire compilé crashe au démarrage (`yoga-wasm-web` ou autre), fallback :
   - Plan B : Node + tsup + binaire via `@yao-pkg/pkg` ou Node SEA.
   - Plan C : distribution `pnpm i -g` (utilisateur doit avoir Node).
   - _Re-vérifié au passage à Ink 7 (août 2026) : yoga reste `yoga-layout@3.2.1` inliné en base64, aucun `.wasm` externe dans l'arbre, le binaire compilé rend correctement._
2. **Cross-device `fs.rename`** : tester explicitement le fallback EXDEV avec une SD card réelle pendant la recette finale.
3. **TTY sur certains émulateurs** (iTerm2, Terminal.app, Warp, kitty) : vérifier le rendu Ink sur au moins iTerm2 et Terminal.app.
4. **Encodages de noms de fichiers** : tester avec accents (`é`), espaces, emoji. Node 24 gère en UTF-8, mais HFS+ vs APFS peut différer sur la normalisation (NFC vs NFD). Au MVP, ne pas normaliser — Node restitue ce que le FS donne.
