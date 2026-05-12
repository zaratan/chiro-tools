# Spec fonctionnelle — MVP

## Commande

```
chiro
```

Pas d'argument, pas de flag (au MVP). Trois exceptions :

- `chiro --version` (ou `-v`) → affiche la version puis quitte.
- `chiro --help` (ou `-h`) → affiche un mini-help (1 paragraphe en français) puis quitte.
- Toute autre forme avec arguments → message "Pas encore supporté, lancez juste `chiro`" et quitte (code 0).

Le dossier ciblé est **toujours `process.cwd()`** (le dossier dans lequel l'utilisatrice a tapé la commande).

## Boot

À l'amorçage, AVANT d'afficher la TUI :

1. Vérifier que `process.stdout.isTTY === true`. Sinon, écrire sur stderr :
   ```
   chiro doit être lancé dans un terminal interactif.
   (Détecté : pas de TTY — il vous a probablement été redirigé.)
   ```
   et quitter avec code 1.
2. Vérifier que le binaire ne tourne pas avec `--version` ou `--help` (cf. ci-dessus).
3. Démarrer le rendu Ink avec le **Menu** comme écran initial.

## Wizard "Préfixer pour Vigie-Chiro" — 5 écrans

```
[Menu] → [Constat] → [Saisie] → [Confirmation] → [Résultat] → (retour Menu)
   └─→  [Update]  → (retour Menu OU exec install.sh + exit)
```

La state machine comporte **5 écrans wizard** (Menu/Constat/Saisie/Confirmation/Résultat) plus **1 écran transverse** (Update, accessible depuis le Menu). ConfirmScreen héberge l'exécution `applyRenames` via un sous-effet interne (transition silencieuse vers Result). L'opération est sub-100 ms en pratique ; un écran flash séparé serait pire que rien.

### Écran 0 — Menu principal

- Titre : `chiro — outils Vigie-Chiro`
- Sous-titre : `Que voulez-vous faire ?`
- Items :
  - `Préfixer des enregistrements pour Vigie-Chiro` (item sélectionné par défaut)
  - `Vérifier les mises à jour`
  - `Quitter`
- **Auto-check au boot** : un `useEffect` lance `checkForUpdate` au mount (cache disque 6 h, silent fail). Si une version > `CHIRO_VERSION` est dispo, un hint jaune `⚠ Une mise à jour est disponible (vX.Y.Z).` apparaît entre la liste d'items et le footer. Sinon (à jour, erreur réseau, etc.), aucun hint.
- Navigation : `↑ ↓` pour bouger la sélection, `Entrée` pour valider, `Échap` ou `Ctrl+C` pour quitter.
- Footer : `↑↓ choisir   Entrée valider   Échap quitter`

### Écran 1 — Constat (pré-scan du dossier)

Affiché dès l'entrée dans le flux de préfixage. **Ne déroule pas** le formulaire tant que ce constat n'est pas validé.

Contenu :

- En-tête : chemin **absolu** du `cwd` (ex : `📁 /Users/.../Vigie-2026-A1/`).
- Compteurs :
  - `N enregistrements .wav trouvés ici` (compte `.wav` ET `.WAV`, case-insensitive)
  - `M fichier(s) déjà au bon format` (matche la regex d'idempotence — sera laissé tel quel)
  - `K autre(s) fichier(s) ignoré(s)` (non `.wav` ; dotfiles ignorés)
- Question : `Ce sont bien les fichiers à préparer ?`
- Footer : `Entrée continuer   Échap retour au menu`

**Cas dégradés (gérés ici)** :

- **Aucun `.wav` trouvé** : message clair, l'utilisatrice ne peut pas continuer. Affiche `pwd`-style aide pour comprendre où elle est. Bouton `Échap` pour quitter.
- **Dossier non lisible** (`fs.access(cwd, R_OK)` échoue) : message clair, quit.
- **Dossier non writable** (`fs.access(cwd, W_OK)` échoue) : avertir avant la saisie, l'utilisatrice ne peut pas continuer. Message orienté solution (copier ailleurs et relancer).

Voir [`ux.md`](./ux.md) pour les wordings exacts.

### Écran 2 — Saisie

Formulaire à **4 champs** dans cet ordre :

| #   | Champ             | Validation                                            | Pré-rempli ?                     |
| --- | ----------------- | ----------------------------------------------------- | -------------------------------- |
| 1   | Code du carré     | `/^\d{6}$/`                                           | Non                              |
| 2   | Année             | `/^\d{4}$/` ET 1900 ≤ valeur ≤ 2100                   | Oui — `new Date().getFullYear()` |
| 3   | Numéro de passage | entier ≥ 1                                            | Oui — `1`                        |
| 4   | Code du point     | `/^[A-Za-z]\d$/` — normalisé en majuscule à la sortie | Non                              |

Comportement :

- **Navigation entre champs** : `↑` / `↓` (ou `Tab` / `Maj+Tab` en alias) pour naviguer entre champs (jamais pour soumettre). `Échap` = retour au Constat.
- **Champs numériques (Année, Passage)** : rendus sans curseur. `←` / `→` décrémentent / incrémentent la valeur, clampée aux bornes du validateur (`[1900, 2100]` pour l'Année, `[1, 9999]` pour le Passage). Saisie au clavier toujours possible (chiffres ajoutés à droite et tronqués à la longueur max ; Backspace supprime le dernier chiffre).
- **Soumission** : `Entrée` tente TOUJOURS la soumission, quel que soit le champ focused. Si invalide, validation déclenchée sur tous les champs simultanément, focus sur le 1er champ invalide.
- **Focus initial au montage** : sur le champ Carré (1er champ vide ; Année et Passage sont préremplis avec des valeurs valides).
- **Validation hybride** :
  - **Pendant la frappe** : silence total. Aucun rouge, aucun compteur de progression.
  - **À la sortie du champ** (`↑`/`↓` ou `Tab`/`Shift+Tab`) ou à la **soumission** (Entrée) : la validation se déclenche. Si invalide, message en rouge à la place de l'aide.
  - **Quand le champ devient valide** : `✓` discret en `dimColor` à droite du champ.
  - **Code point lowercase** (ex `a1`) : au blur, afficher en `dimColor` `sera enregistré en A1`.
- **Footer** : `↑↓ champ   ←→ ajuster   Entrée valider   Échap retour`

**Génération du préfixe** (uniquement après validation complète) :

```
Car{carré}-{année}-Pass{passage}-{point uppercase}-
Ex : Car040962-2026-Pass3-A1-
```

### Écran 3 — Confirmation

Affiché immédiatement après soumission valide du formulaire. **Précalcule** le plan complet de renommage avant affichage.

Contenu :

- Titre : `On va renommer N fichiers comme ceci :`
- **3 exemples** `avant → après` (1er, milieu, dernier dans l'ordre alphabétique des noms d'origine ; si N ≤ 3, on les affiche tous).
- Si `N > 3` : `... et X autres fichiers du même genre` après les 3 exemples.
- Si fichiers déjà préfixés détectés au Constat : rappel `ℹ M fichier(s) sera/seront laissé(s) tel(s) quel(s) (déjà au bon format) :` + liste tronquée si > 3.
- **Détection de collision au plan-time** : si un nom cible existerait déjà sur disque (hors le fichier source lui-même), l'afficher en `yellow` AVANT exécution :
  `⚠ N collision(s) détectée(s) — ces fichiers ne seront pas renommés :` + liste.
- Phrase de réassurance : `Le nom original est conservé en fin du nouveau nom — rien n'est perdu.`
- Footer : `Entrée renommer   Échap modifier la saisie`

### Écran 4 — Résultat

Affiché après exécution. Trois variantes possibles selon l'issue :

**Variante A — Tout s'est bien passé**

- `✓ Terminé !`
- `N fichiers renommés`
- `M fichier(s) laissé(s) tel(s) quel(s) (déjà au bon format)` (si M > 0)
- Phrase d'invitation à uploader vers Vigie-Chiro.
- Footer : `Entrée retour au menu`

**Variante B — Rien à faire (tout déjà préfixé)**

- `✓ Rien à faire — tout est déjà au bon format.`
- `N fichiers déjà nommés correctement.`
- Pas d'erreur, ton positif.

**Variante C — Renommage avec erreurs partielles**

- `⚠ Renommage terminé avec X souci(s)`
- `K fichiers renommés ✓`
- Liste des fichiers en échec avec **la raison** (collision sur disque, EACCES, ENOENT, autre I/O).
- Phrase rassurante : `Les autres fichiers ont bien été renommés.`

**Variante D — Ctrl+C en plein renommage**

- `⚠ Renommage interrompu`
- `K fichiers déjà renommés ✓ (conservés)`
- `Reste R fichiers non traités.`
- `Vous pouvez relancer chiro, les fichiers déjà renommés seront automatiquement reconnus.` (rappel idempotence)

Voir [`ux.md`](./ux.md) pour les wordings exacts.

## Wizard "Découper les enregistrements" — 4 écrans (Phase 5)

```
[Menu] → [P-Constat] → [P-Saisie] → [P-Confirmation] → [P-Résultat] → (retour Menu)
```

Internalise les étapes `Découpage des données (AudioMoth only)` + `Kaleidoscope` du protocole Vigie-Chiro Point Fixe (cf. `test-data/Tutoriel Vigie Chiro - Perso.pdf` p. 5 et p. 7). Sortie : sous-dossier `processed/` dans le cwd. **Non-destructif** : les fichiers d'origine ne sont jamais modifiés.

### Écran P-Constat

Identique en posture à l'Écran 1 (cf. `ux.md` pour les wordings), mais avec **deux vérifications supplémentaires** :

- **`processed/` existant** non-vide → bloque avec warning **jaune `⚠`** : propose à l'utilisatrice de **renommer ou supprimer** l'ancien dossier (non-destructif — ne propose pas d'écraser).
- **Espace disque** insuffisant (`fs.statfs` → `free < total_input × 1.05`) → bloque avec warning jaune chiffré.

### Écran P-Saisie

**Un seul champ** : sélecteur radio inline (↑↓ Entrée). Deux options :

- `Boîtier PaRec (Teensy) — fichiers déjà au bon format` (`mode: "preserve"`)
- `Autre détecteur — fichiers à ralentir 10× pour l'analyse` (`mode: "expand-10x"`)

Aide `dimColor` sous le sélecteur explique le pourquoi du ralentissement (full-spectrum vs déjà-expansé). Pas de Tab, pas de `←→` (1 seul champ).

### Écran P-Confirmation

Preview :

- chemin absolu du cwd
- `On va découper N enregistrements (environ X minutes d'audio) en morceaux de 5 secondes.`
- type d'enregistreur choisi (libellé du mode)
- dossier de sortie : `./processed/`
- **réassurance non-destructive** : `Vos fichiers d'origine ne seront pas modifiés.`

Footer : `Entrée découper   Échap modifier la saisie`.

L'estimation de durée est **best-effort** basée sur la taille du fichier (16-bit PCM mono assumed). Pour stéréo on overestimate ×2 — acceptable pour un preview qui sert juste à donner un ordre de grandeur.

### Contrat `onProgress` — progression intra-batch

Le flow Découper peut traiter une centaine de fichiers (~25 min de run nominal sur 100 AudioMoth). Pour rassurer l'utilisatrice non-tech qui ne peut pas distinguer un freeze d'une progression normale, `processWavFiles` accepte un callback `onProgress?: (event: ProgressEvent) => void`.

Le type `ProgressEvent` (dans `src/types.ts`) est une union discriminée sur `kind` :

| `kind`          | Quand                                             | Données utiles                                         |
| --------------- | ------------------------------------------------- | ------------------------------------------------------ |
| `file-start`    | Après `stat`, avant `readFile`                    | `fileIndex`, `fileName`, `fileSizeBytes`, `totalFiles` |
| `chunk-written` | Après chaque `writeFileAtomic` réussi             | `fileIndex`, `chunkIndex`                              |
| `file-done`     | Après sortie nominale de la boucle `splitWavFile` | `fileIndex`, `chunkCount`, `fileSizeBytes`             |

**Aucun event** n'est émis pour les `skippedTooLarge`, `skippedAlreadyChunked`, `stat`-errors, `readFile`-errors, `splitWavFile` errors, ni en cas d'abort. Ces signaux restent observables sur le `ProcessOutcome` final. La surface étroite est volontaire — on l'élargira quand un consommateur en aura besoin.

Le callback est **synchrone** (le lib n'`await` pas). Toute exception levée est interceptée :

- En mode dev (`process.env.CHIRO_DEV === "1"`), la stack est loggée via `console.error`.
- Sinon, silencieux — un bug UI ne doit jamais crasher le batch d'un user non-tech.

### Calcul de l'ETA (byte-weighted)

L'ETA est calculé par `src/lib/audio/etaTracker.ts` selon la formule :

```
remainingMs = elapsedMs × (bytesRemaining / bytesDone)
```

avec `bytesDone` incrémenté à chaque `file-done` (du nombre de bytes du fichier qui vient de se terminer). Tant que `bytesDone === 0` (pas encore un fichier complet), `estimateRemainingMs` retourne `null` et l'UI affiche `Calcul du temps restant…`.

**Pourquoi byte-weighted plutôt que par-compte-de-fichiers** : les batches Vigie-Chiro sont hétérogènes (un AudioMoth full ≈ 143 MB / 60 s vs un Teensy ≈ 4 MB / 50 s). Pondérer par octets stabilise l'estimation : un batch mixte 2 AudioMoth + 5 Teensy ne voit pas son ETA exploser à cause des 2 fichiers de 143 MB.

**Adaptive masking** : pour `filesTotal < 5`, l'UI masque la portion ETA de la ligne stats (la barre reste). L'estimation à 1-4 fichiers est trop coarse pour être informative et son affichage parasite plus qu'il n'aide.

### Écran P-Résultat

Quatre variantes, mêmes principes UX que le rename :

**Variante A — Succès complet**

- `✓ Terminé !`
- `N enregistrements découpés`
- `M morceaux créés dans ./processed/`
- (si applicable) skipped trop volumineux / déjà au format morceau en `dimColor`
- réassurance `Vos fichiers d'origine sont intacts dans ce dossier.`

**Variante B — Interrompu (Ctrl+C)**

- `ℹ Découpage arrêté à votre demande`
- résumé partiel + invitation à supprimer / renommer le `processed/` partiel avant de relancer

**Variante C — Tout en échec** (rare — disque plein dès le 1er fichier, ou tous les fichiers non-PCM)

- `⚠ Aucun enregistrement n'a pu être découpé`
- groupage des erreurs par message
- pas de réassurance positive — la situation est anormale

**Variante D — Erreurs partielles**

- `⚠ Découpage terminé avec X souci(s)`
- résumé succès + groupage erreurs avec `TRUNCATE_PER_GROUP = 5`
- `Les autres enregistrements ont bien été découpés.`
- réassurance non-destructive

### Règles métier — Découpage

**Mode `preserve`** (Teensy / PaRec) : aucune modification du sample rate. Slice par tranches de `sampleRate × 5` samples.

**Mode `expand-10x`** (AudioMoth / Wildlife Acoustics) : réécriture lossless du `fmt.sampleRate` (= `Math.round(source / 10)`), puis slice par tranches de `outputSampleRate × 5` samples. Les samples PCM eux-mêmes ne sont jamais touchés — seul le champ d'en-tête change, ce qui équivaut à un ralentissement à la lecture.

**Référentiel des 5 s** : la timeline **du fichier de sortie**. Pour un fichier AudioMoth 250 kHz expansé en 25 kHz, 5 s de sortie = 0.5 s de temps réel. Convention alignée sur Kaleidoscope.

**Multicanal** : les canaux sont conservés groupés dans chaque chunk (1 fichier stéréo → 1 fichier stéréo par chunk, pas 2 mono). À noter : Kaleidoscope coche par défaut « Split channels » → séparation en mono. Notre v1 garde groupé ; option de split en mono prévue en V2 (cf. `roadmap.md` follow-ups Phase 5).

**Dernier chunk < 5 s** : conservé tel quel (lossless). Tadarida peut l'analyser avec une confiance moindre. Pas de padding silence, pas de drop.

**Filtre `_NNN.wav$`** : tout fichier source dont le nom matche `_\d{3}\.wav$` (case-insensitive ext) est **skippé silencieusement** et reporté dans `skippedAlreadyChunked`. Évite de re-splitter par accident des morceaux déjà produits qui auraient été déplacés à la racine.

**Hard cap 500 MB** par fichier source. Au-delà, le fichier est skippé (`skippedTooLarge`) sans tentative de lecture. Évite l'OOM sur les workstations 8 GB (`wavefile` charge tout en RAM).

**AbortSignal (Ctrl+C)** : check entre fichiers ET entre chunks d'un même fichier. Le chunk write en cours ne peut pas être interrompu mid-syscall — c'est borné à ~100 ms par chunk.

**Allowlist de formats** : `audioFormat ∈ {1 (PCM standard), 0xFFFE (EXTENSIBLE) avec subformat PCM}`. Bit depth 16 ou 24. Tout autre format → `ProcessError { reason: "unsupported-format" }`.

### Glossaire — vocabulaire technique

- **Time expansion ×10** : technique consistant à réécrire le sample rate d'un fichier ultrasonique pour que sa lecture soit 10× plus lente, donc audible. Pour un AudioMoth 250 kHz, on déclare 25 kHz → ce qui se prononçait à 80 kHz se joue à 8 kHz. Aucun sample modifié, juste un champ d'en-tête. Voir `architecture.md` § ADR pour les détails.
- **5 s « en référentiel audio expansé »** : 5 s tels que mesurés sur la timeline du fichier de sortie. Si le fichier de sortie est à 25 kHz (post-TE×10) et qu'il représente du réel 250 kHz, alors 5 s d'audio expansé = 0.5 s de temps réel.
- **PCM** : Pulse-Code Modulation. Format audio non compressé, échantillons entiers signés (16-bit ou 24-bit dans la chaîne Vigie-Chiro). Seul format accepté.

### Écran 5 — Mise à jour (transverse)

Accessible depuis l'item de menu **"Vérifier les mises à jour"**. Indépendant du wizard de préfixage.

**Flux** :

1. Au mount, l'écran lance `fetchLatestVersion` (cache pas relu — l'utilisatrice attend une vérif fraîche puisqu'elle a cliqué explicitement). Pendant le fetch, l'écran affiche `Vérification de la dernière version…` et **désactive Ctrl+C global** via `runningRef` pour ne pas tuer le fetch en cours (l'utilisatrice peut toujours sortir avec Échap).
2. Selon le résultat :
   - **Version distante > `CHIRO_VERSION`** : affiche `✓ Une nouvelle version est disponible : vX.Y.Z` + avertissement explicite que chiro va se fermer + footer `Entrée installer   Échap retour au menu`.
   - **Versions égales ou locale > distante** : affiche `✓ Vous êtes à jour.` + footer `Échap retour au menu`.
   - **Erreur réseau / parse / rate-limit** : affiche un message d'erreur lisible avec mapping FR (cf. table ci-dessous).
3. Sur **Entrée** en état "available" : pose un drapeau via `onRequestInstall()` (qui remonte jusqu'à `index.tsx`), puis `useApp().exit()`. Pas d'écran intermédiaire — `install.sh` produit son propre feedback "Téléchargement…" en sortie de Ink.

**Exécution post-Ink** : après `render().waitUntilExit()`, si le drapeau est posé, `index.tsx` lance `spawnSync("bash", ["-c", "curl -fL .../install.sh | bash"], { stdio: "inherit" })` puis `process.exit(proc.status ?? 0)`. Stdout/stderr/stdin sont hérités — l'utilisatrice voit la progression curl + le `chiro installé dans ~/.local/bin/chiro` final.

**Codes d'erreur Update** :

| Code          | Cause                                                |
| ------------- | ---------------------------------------------------- |
| `network`     | DNS échec / connection refused                       |
| `timeout`     | `AbortSignal.timeout(15_000)` déclenché              |
| `http-403`    | Rate-limit GitHub (60 req/h non-authentifié)         |
| `http-404`    | Repo sans release publiée                            |
| `parse`       | Body non-JSON, `tag_name` absent / non-string / vide |
| `parse-local` | `CHIRO_VERSION` ne matche pas le parser semver       |

Tous les codes mappent en messages français lisibles (cf. `ux.md` → "Codes d'erreur Update → libellés FR").

**Limite connue** : en cas d'échec d'`install.sh` (réseau coupé en plein download), l'utilisatrice voit le `stderr` de curl, pas un message chiro-friendly. Acceptable pour le MVP.

## Règles métier

### Détection des `.wav`

- Scan **non-récursif** de `process.cwd()`.
- Filtre : nom se terminant par `.wav` OU `.WAV` (case-insensitive sur l'extension uniquement).
- Ignorer : dotfiles (`.foo.wav`), dossiers, symlinks (au moins MVP — on ignore pour rester safe).
- Conserver l'ordre alphabétique stable (utile pour l'écran de confirmation).

### Idempotence

Un fichier est considéré "déjà préfixé" si son nom matche :

```regex
^Car\d{6}-\d{4}-Pass\d+-[A-Za-z]\d-
```

Si oui → le fichier est skippé (pas renommé), compté séparément, mentionné au Constat et au Résultat.

### Construction du nom cible

```
{préfixe}{nom-original-sans-extension}.wav
```

Où :

- `{préfixe}` = `CarXXXXXX-AAAA-PassN-YY-` (cf. Saisie)
- `{nom-original-sans-extension}` = nom du fichier original débarrassé de son extension
- L'extension finale est **toujours `.wav` minuscule**, même si l'original était `.WAV` (normalisation).

Exemple :

- Avant : `20260511_213045.WAV`
- Après : `Car040962-2026-Pass3-A1-20260511_213045.wav`

### Renommage

- **Séquentiel** (pas de `Promise.all`). On traite fichier par fichier dans l'ordre alphabétique.
- Utiliser `fs.rename` en premier. Si échec avec code `EXDEV` (cross-device, typique SD card) → fallback `fs.copyFile` + `fs.unlink`.
- Sur toute autre erreur I/O par fichier (`EACCES`, `EPERM`, `ENOENT`, `EEXIST`…) → capturer, consigner, **continuer** avec le fichier suivant. Ne jamais crasher la boucle entière sur un fichier.
- Capturer `SIGINT` (Ctrl+C) :
  - Si reçu **pendant** la boucle de renommage : terminer le rename en cours, **stopper la boucle**, afficher la variante D du Résultat.
  - Si reçu **hors** boucle (saisie, etc.) : quit normal, code 130.

### Collision (au plan-time et au rename-time)

- **Plan-time** : avant l'exécution, vérifier pour chaque rename prévu que le nom cible n'existe pas déjà sur disque. Si oui, marquer la collision et NE PAS l'inclure dans le batch d'exécution. Afficher la liste en jaune sur l'écran de Confirmation.
- **Rename-time** : double sécurité. Si `fs.rename` échoue avec `EEXIST`, capturer et consigner. (Ne devrait jamais arriver après le plan, mais protection en cas de race condition.)
- **Collision intra-plan** : si deux fichiers source produisent le même nom cible (cas APFS case-insensitive, ou collisions liées à la normalisation `.WAV → .wav`), le premier dans l'ordre alphabétique est conservé dans `operations`, les suivants vont dans `skippedCollision`.

## Logging local

Chaque session écrit un événement JSONL en `append` dans `~/.chiro/sessions.jsonl` (créer le dossier au boot s'il n'existe pas).

Format d'un événement :

```json
{
  "schema_version": 1,
  "ts": "2026-05-11T21:30:45.123Z",
  "version": "0.1.0",
  "cwd": "/Users/.../Vigie-2026-A1",
  "action": "vigie-prefix",
  "input": {
    "squareCode": "040962",
    "year": 2026,
    "passNumber": 3,
    "pointCode": "A1"
  },
  "result": {
    "renamed": 7,
    "skipped_already_prefixed": 1,
    "skipped_collision": 0,
    "errored": [{ "file": "...", "reason": "EACCES" }],
    "interrupted": false,
    "duration_ms": 42
  }
}
```

Le log est **append-only** (jamais tronqué). À surveiller dans le futur : rotation si dépassement de taille — pas dans le MVP.

### Schéma v2 — sessions `vigie-process` (Phase 5)

Pour les sessions de découpage, `schema_version: 2`. Format aligné avec v1 (timestamps, version, cwd) mais avec `input` et `result` adaptés au domaine :

```json
{
  "schema_version": 2,
  "ts": "2026-05-11T22:00:00.000Z",
  "version": "0.2.0",
  "cwd": "/Users/.../Vigie-2026-A1",
  "action": "vigie-process",
  "input": { "mode": "expand-10x" },
  "result": {
    "processed": [
      {
        "source_file": "20260511_220000T.WAV",
        "chunk_count": 60,
        "output_sample_rate": 25000,
        "channels": 1
      }
    ],
    "errored": [],
    "skipped_too_large": [],
    "skipped_already_chunked": [],
    "interrupted": false,
    "duration_ms": 14523
  }
}
```

**v1 reste byte-stable** : tout reader jq existant qui filtre sur `.action == "vigie-prefix"` ou `.schema_version == 1` continue à fonctionner. Un snapshot test (`src/lib/logging/log.test.ts`) asserte caractère par caractère le format v1 pour empêcher toute dérive silencieuse.

## Versioning

- `chiro --version` lit la version dans `package.json` (bundled au moment du `bun build --compile`).
- La version est aussi loggée dans chaque entrée du log local.
- Schéma : SemVer (`0.1.0` au MVP).

## Cas dégradés — checklist exhaustive

| Cas                                                       | Comportement attendu                                                                                                                       | Écran                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| Pas de TTY                                                | Message stderr + quit code 1                                                                                                               | Avant Ink               |
| `--version`                                               | Affiche version + quit code 0                                                                                                              | Avant Ink               |
| `--help`                                                  | Affiche help + quit code 0                                                                                                                 | Avant Ink               |
| Dossier vide                                              | "Aucun fichier .wav trouvé" + chemin affiché                                                                                               | Constat                 |
| Aucun `.wav` (mais d'autres fichiers)                     | Idem                                                                                                                                       | Constat                 |
| Tous les `.wav` déjà préfixés                             | Constat passe normalement → Saisie → Confirmation affiche 0 renommage prévu → l'utilisatrice peut quand même valider → Résultat variante B | Tous les écrans         |
| Dossier non lisible (`R_OK` KO)                           | Message + quit                                                                                                                             | Constat                 |
| Dossier non writable (`W_OK` KO)                          | Message + bouton retour                                                                                                                    | Constat                 |
| Erreur inattendue au scan FS                              | Écran Constat affiche le code brut + invite à fermer apps concurrentes                                                                     | Constat                 |
| `.WAV` majuscule                                          | Normalisé en `.wav` dans le nom cible                                                                                                      | Renommage               |
| Collision avec fichier existant                           | Affichage Confirmation + skip Renommage                                                                                                    | Confirmation + Résultat |
| `EXDEV` cross-device                                      | Fallback `copyFile + unlink` transparent                                                                                                   | Renommage               |
| `EACCES` / `EPERM` sur un fichier                         | Consigner, continuer                                                                                                                       | Renommage               |
| `ENOENT` (fichier supprimé entre scan et rename)          | Consigner, continuer                                                                                                                       | Renommage               |
| Caractères exotiques (accents, espaces, emojis) dans noms | Aucun traitement spécial, Node gère                                                                                                        | Toujours                |
| Symlinks dans le dossier                                  | Ignorés au scan                                                                                                                            | Constat                 |
| Ctrl+C pendant la saisie                                  | Quit immédiat code 130                                                                                                                     | Toutes                  |
| Ctrl+C pendant le renommage                               | Stop propre, Résultat variante D                                                                                                           | Renommage → Résultat    |
| Terminal redimensionné en cours                           | Ink gère ; aucun traitement spécial requis                                                                                                 | Toutes                  |
