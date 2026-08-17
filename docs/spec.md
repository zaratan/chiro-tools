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
  - `Découper les enregistrements (pour Tadarida)`
  - `Créer les zips à déposer sur Vigie-Chiro`
  - `Sauvegarder les enregistrements découpés (un seul zip)`
  - `Vérifier les mises à jour`
  - `Quitter`

Six entrées depuis la Phase 9 : les deux flux zip (dépôt / sauvegarde) sont deux entrées distinctes, pas un sélecteur — les deux sorties coexistent et ne servent pas au même usage. `Préfixer` et `Préparer` partageant leurs quatre premières lettres, le verbe retenu pour le dépôt est **« Créer »** : six initiales restent ainsi distinctes au scan.

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
- Phrase d'orientation vers l'étape suivante : `Vous pouvez maintenant les découper, puis créer les zips à déposer`. Elle a remplacé en 9.D un « vous pouvez maintenant les téléverser sur Vigie-Chiro » devenu faux — depuis les Phases 5 et 9, il faut découper puis empaqueter avant de déposer quoi que ce soit.
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
- `On va découper N enregistrements (environ X minutes d'audio) en fichiers de 5 secondes.`
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
- `M fichiers créés dans ./processed/`
- (si applicable) skipped trop volumineux / déjà découpé en `dimColor`
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

**Convention de durée** : un chunk couvre **5 secondes de temps réel ultrasonique**. Comme Teensy et AudioMoth produisent tous deux un signal joué en time-expansion ×10 dans le fichier de sortie, **5 s temps réel = 50 s sur la timeline de sortie audio**. C'est la convention Kaleidoscope, et celle attendue par Chirosuf / Tadarida. Les constantes vivent dans `src/lib/audio/constants.ts` (`CHUNK_OUTPUT_SECONDS = 50`, `CHUNK_REAL_SECONDS = 5`).

**Mode `preserve`** (Teensy / PaRec) : aucune modification du sample rate (Teensy enregistre déjà à un débit audio expansé). Slice par tranches de `sampleRate × 50` samples.

**Mode `expand-10x`** (AudioMoth / Wildlife Acoustics) : réécriture lossless du `fmt.sampleRate` (= `Math.round(source / 10)`), puis slice par tranches de `outputSampleRate × 50` samples. Les samples PCM eux-mêmes ne sont jamais touchés — seul le champ d'en-tête change, ce qui équivaut à un ralentissement à la lecture.

**Multicanal** : les canaux sont conservés groupés dans chaque chunk (1 fichier stéréo → 1 fichier stéréo par chunk, pas 2 mono). À noter : Kaleidoscope coche par défaut « Split channels » → séparation en mono. Notre v1 garde groupé ; option de split en mono prévue en V2 (cf. `roadmap.md` follow-ups Phase 5).

**Dernier chunk < 5 s temps réel** : conservé tel quel (lossless). Tadarida peut l'analyser avec une confiance moindre. Pas de padding silence, pas de drop. La métadonnée GUANO `Length` reflète la durée réelle de ce tail chunk.

**Filtre `_NNN.wav$`** : tout fichier source dont le nom matche `_\d{3}\.wav$` (case-insensitive ext) est **skippé silencieusement** et reporté dans `skippedAlreadyChunked`. Évite de re-splitter par accident des fichiers déjà découpés qui auraient été déplacés à la racine.

**Hard cap 500 MB** par fichier source. Au-delà, le fichier est skippé (`skippedTooLarge`) sans tentative de lecture. Évite l'OOM sur les workstations 8 GB (`wavefile` charge tout en RAM).

**AbortSignal (Ctrl+C)** : check entre fichiers ET entre chunks d'un même fichier. Le chunk write en cours ne peut pas être interrompu mid-syscall — c'est borné à ~100 ms par chunk.

**Allowlist de formats** : `audioFormat ∈ {1 (PCM standard), 0xFFFE (EXTENSIBLE) avec subformat PCM}`. Bit depth 16 ou 24. Tout autre format → `ProcessError { reason: "unsupported-format" }`.

### Métadonnées GUANO / wamd

Chaque chunk de sortie reçoit, après le `data` chunk, deux RIFF ancillaires alignés sur ce que Kaleidoscope produit :

- **`wamd`** (Wildlife Acoustics) : enregistrements `tag (uint16 LE) + length (uint32 LE) + value`. Tags écrits : `0x0000` WA Version (uint16 = 1), `0x000F` TE (uint16 = 10), `0x0005` Timestamp (ISO 8601 + offset TZ local), `0x0008` Software (`chiro <version>`).
- **`guan`** (GUANO 1.0, [spec](https://github.com/riggsd/guano-spec)) : UTF-8, lignes `key:value\n` — `GUANO|Version`, `Length` (5.000000 s temps réel), `Original Filename`, `Samplerate` (= rate réel ultrasonique = output × 10), `TE` (= 10), `Timestamp` (omis si non parsable depuis le nom de fichier), `WA|chiro|Version`.

Implémentation : `src/lib/audio/metadata/{guano,wamd,chunkMetadata}.ts`, appendage via `appendAncillaryChunks` dans `src/lib/audio/finalizeChunk.ts`. Le pipeline sox et le worker pool partagent les mêmes builders, donc les sorties sont byte-identiques modulo l'horodatage parsé.

**Kill-switch** : `CHIRO_DISABLE_METADATA=1` désactive entièrement l'append. Utile en cas de divergence remontée par un outil aval (rollback ops sans rebuild). État tracé dans `~/.chiro/sessions.jsonl` sous `result.metadata: "full" | "off"`.

### Glossaire — vocabulaire technique

- **Time expansion ×10** : technique consistant à réécrire le sample rate d'un fichier ultrasonique pour que sa lecture soit 10× plus lente, donc audible. Pour un AudioMoth 250 kHz, on déclare 25 kHz → ce qui se prononçait à 80 kHz se joue à 8 kHz. Aucun sample modifié, juste un champ d'en-tête. Voir `architecture.md` § ADR pour les détails. Le Teensy enregistre **nativement** à un débit audio expansé : c'est pourquoi son mode `preserve` ne touche pas au sample rate.
- **5 s temps réel** : convention de découpe. Sur la timeline du fichier de sortie (TE×10), cela correspond à 50 secondes d'audio à écouter.
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

**Exécution post-Ink** : après `render().waitUntilExit()`, si le drapeau est posé, `index.tsx` lance `spawnSync("bash", ["-c", "curl -fL .../install.sh | bash"], { stdio: "inherit" })` puis `process.exit(proc.status ?? (proc.signal !== null ? 130 : 1))`. Stdout/stderr/stdin sont hérités — l'utilisatrice voit la progression curl + le `chiro installé dans ~/.local/bin/chiro` final. L'URL du script est épinglée sur le tag de la version courante depuis le Chantier D (cf. `architecture.md` § Contrat `install.sh`), pas `main`.

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

**Échec d'`install.sh`** : sur une somme de contrôle invalide (fichier corrompu/tronqué), le script affiche lui-même un message français bienveillant plutôt qu'une erreur brute (cf. `ux.md` § Self-update). Une coupure réseau en plein `curl` du tarball reste, elle, visible en `stderr` brut de curl (limite connue, acceptable) — mais dans tous les cas d'échec, `index.tsx` affiche en plus, après coup, un message pointant vers une commande de secours (`FALLBACK_INSTALL_SCRIPT_URL`, resté sur `main`), pour que l'utilisatrice ait toujours une action claire à faire même quand le message technique qui précède ne l'est pas.

## Wizard "Sauvegarder les enregistrements découpés" — 3 écrans (Phase 8)

```
[Menu] → [A-Constat] → [A-Confirmation] → [A-Résultat] → (retour Menu)
```

Rassemble le contenu de `processed/` (sortie du flow Découper) dans **une** archive zip unique. Depuis la Phase 9, ce zip n'est plus destiné au dépôt (le portail Vigie-Chiro refuse le ZIP64, et sur des volumes réels ce zip en est) : c'est la **copie de sauvegarde**, l'objet unique qu'on archive pour retrouver une étude des années plus tard. Le dépôt passe par le wizard « Créer les zips à déposer » ci-dessous. Pas d'écran de saisie : il n'y a rien à choisir, tout est déduit du dossier courant. **Non-destructif** : `processed/` n'est ni déplacé, ni modifié, ni supprimé — le zip est une copie.

### Source, destination, nommage

- **Source** : `<cwd>/processed/`, niveau 1 uniquement (pas de récursion).
- **Destination** : `<cwd>/archived/`, créé au besoin (`mkdir -p`).
- **Nom** : `{préfixe}_YYYYMMDD.zip` — date **locale** au moment de l'entrée dans l'écran de Confirmation (`buildArchiveName`, pur). Le `{préfixe}` est le préfixe Vigie-Chiro commun à **tous** les fichiers du lot (`extractCommonPrefix`), sinon `processed` : `Car340581-2026-Pass1-A1_20260814.zip` ou `processed_20260814.zip`. Le cas d'usage de l'archive est « dans trois ans, un client redemande les données de son étude » : à cette échéance la minute de fabrication du zip n'est pas la donnée qu'on cherche, le nom parlant est déjà dans les fichiers. Granularité **au jour** depuis la Phase 9 (avant : `processed_YYYYMMDDHHMM.zip`).
- **Collision** : si le nom existe déjà, suffixes `-2` … `-99` insérés avant l'extension (`processed_20260814-2.zip`). Au-delà → code `collision-exhausted`. Conséquence assumée de la bascule à la journée : deux runs **le même jour** collisionnent (au lieu de deux runs la même minute) — le suffixe devient donc nettement plus visible. Le nom est résolu **deux fois** — une fois pour l'affichage en Confirmation, une seconde juste avant le run, pour réduire la fenêtre entre l'aperçu et la validation. Aucun écran « un zip existe déjà, que faire ? » : le nom daté distingue les zips, proposer « remplacer » violerait le principe non-destructif.

### Contenu et exclusions

Entrées **à plat, à la racine du zip** (pas de dossier `processed/` intermédiaire) : c'est ce qu'attend le dépôt Vigie-Chiro.

| Entrée dans `processed/`                | Incluse ? |
| --------------------------------------- | --------- |
| Fichier régulier visible                | oui       |
| Sous-dossier                            | non       |
| Symlink (même vers un fichier régulier) | non       |
| Dot-entry (`.DS_Store`, `.sox-tmp-*`)   | non       |
| Fichier `*.tmp`                         | non       |

Le filtre dot/`.tmp` est le prédicat partagé `isVisibleNonTmpEntry` (`src/lib/fs/scanDirectory.ts`), le même que celui qui détecte un `processed/` déjà peuplé au flow Découper. Ordre alphabétique. Le timestamp DOS de chaque entrée est le `mtime` du fichier source.

Conséquence assumée sur le wording : le Constat ne dit jamais « le dossier est vide » mais « ne contient aucun enregistrement » — les exclus restent visibles dans le Finder (cf. `ux.md`).

### Écran A-Constat

Scan de `processed/` + vérifications, puis question de confirmation (`N enregistrements trouvés dans ./processed/` + `Volume total`).

Cas bloquants, dans l'ordre où ils sont évalués :

| Cas                 | Détection                                                           |
| ------------------- | ------------------------------------------------------------------- |
| `no-processed`      | `ENOENT` sur le `readdir` de `processed/`                           |
| `empty-processed`   | dossier présent, zéro entrée retenue par le filtre                  |
| `scan-error`        | toute autre erreur de `readdir`/`stat` (code brut affiché)          |
| `not-writable`      | `access(cwd, W_OK)` échoue — le `archived/` ne pourra pas être créé |
| `insufficient-disk` | `statfs(cwd)` : `bavail × bsize < Σ tailles + N × 200 o + 1 Mio`    |

`no-processed` et `empty-processed` sont deux états distincts parce que la guidance diffère (mauvais dossier vs découpage interrompu). Le pré-check disque prend la **borne supérieure** (deflate ≤ stored + ε), pas un facteur de sécurité arbitraire ; un `statfs` en échec ne bloque pas — `ENOSPC` sera de toute façon remonté à l'écriture.

### Écran A-Confirmation

Aperçu (nom du fichier, emplacement, taille maximale) puis exécution en place — pas d'écran intermédiaire, la vue de progression remplace l'aperçu dans le même écran (même posture que P-Confirmation).

**Progression** : barre pilotée par les **octets lus en source** (`bytesRead / totalBytes`), pas par le nombre d'entrées ni par les octets écrits — la compression varie d'une entrée à l'autre et rendrait une barre en octets écrits non monotone en apparence. `Enregistrement X sur N` + temps écoulé + temps restant, ce dernier via `etaTracker` alimenté à chaque entrée terminée (byte-weighted, cf. § Calcul de l'ETA). Throttle 100 ms, `finalizeRender()` synchrone pour forcer 100 % avant démontage.

**Ctrl+C pendant le run** : géré par le `useInput` de l'écran (le handler global d'`app.tsx` s'efface tant que `runningRef` est vrai) → abort → le `.tmp` en cours est supprimé → A-Résultat variante « interrompu ». Aucun zip partiel ne subsiste.

**Erreur pendant le run** : reste sur A-Confirmation en variante `run-error` (message mappé + détail technique), `Échap` revient au Constat.

### Écran A-Résultat

Deux variantes seulement — une erreur n'atteint jamais cet écran (elle reste sur A-Confirmation) :

**Variante A — Succès** : `✓ Terminé !`, nombre d'entrées, chemin relatif du zip, taille réelle, temps écoulé, puis — depuis la Phase 9 — **pas** d'invitation au dépôt mais l'inverse : ce fichier est la copie de sauvegarde, et le dépôt se fait via l'entrée de menu « Créer les zips à déposer sur Vigie-Chiro », citée **exactement** (cf. `ux.md`). Rappel que `processed/` est intact.

**Variante B — Interruption** : `ℹ Création du zip arrêtée à votre demande`, `Aucun fichier zip n'a été créé.`, rappel non-destructif.

### États d'erreur — codes

Codes bruts produits par la lib, traduits en français par `src/screens/archive/errorMessages.ts` (les codes système passent par `src/screens/fsErrorMessages.ts`, partagé par les trois flows). Table des libellés dans [`ux.md`](./ux.md) § « Codes d'erreur Archive → libellés FR ».

| Code                                    | Cause                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `mkdir:<code>`                          | Création de `archived/` impossible                                                                 |
| `ENOSPC` / `EACCES` / `EPERM` / `EROFS` | Codes système remontés tels quels par l'écriture, le `sync()` ou le `close()`                      |
| `ENOENT`                                | Un fichier source a disparu entre le scan et son ouverture                                         |
| `file-changed`                          | Taille du fichier source différente entre le scan et le re-`stat`, ou octets lus ≠ taille attendue |
| `entry-too-large`                       | Une entrée ≥ 4 Gio (garde ; les fichiers découpés font quelques Mo)                                |
| `verify-failed`                         | La vérification post-écriture a échoué — le zip est supprimé, rien n'apparaît dans `archived/`     |
| `collision-exhausted`                   | 99 zips déjà créés dans la même minute                                                             |

Dans **tous** les cas d'échec, y compris interruption, aucun fichier n'apparaît dans `archived/` : l'écriture se fait dans un `.tmp` renommé en tout dernier (cf. `architecture.md` § « Module `lib/archive` »).

## Wizard "Créer les zips à déposer sur Vigie-Chiro" — 3 écrans (Phase 9)

```
[Menu] → [U-Constat] → [U-Confirmation] → [U-Résultat] → (retour Menu)
```

Même posture que le wizard de sauvegarde — mêmes écrans, mêmes vérifications, mêmes composants — mais une **série** de zips au lieu d'un seul, chacun garanti sans ZIP64 (le portail Vigie-Chiro le refuse). C'est ce flux qui ferme la boucle du protocole : ses fichiers sont ceux qu'on dépose. **Non-destructif** vis-à-vis de `processed/`.

### Source, destination, nommage

- **Source** : `<cwd>/processed/`, niveau 1 uniquement — même scan et mêmes exclusions que le flux sauvegarde (`isVisibleNonTmpEntry`).
- **Destination** : `<cwd>/upload/<série>/`, créé au besoin. Le dossier de série **apparaît d'un coup, complet**, en fin de run : les volumes sont écrits dans un dossier de staging caché (`upload/.<série>.<pid>.tmpdir/`) publié par un seul `rename`.
- **Nom de la série** : `{préfixe}_YYYYMMDD` (même `extractCommonPrefix` que la sauvegarde), sinon `depot_YYYYMMDD`.
- **Nom des volumes** : `{série}_partN.zip`, numérotation 1-based, **zéro-padding dynamique** au-delà de 9 volumes (`part01`…`part12`) — sans quoi `part10` se trie avant `part2` dans le Finder. Pas de `-sur-N` : le nom seul ne dit donc pas combien de fichiers composent la série, c'est l'écran de résultat qui le dit et le dossier qui les contient tous.
- **Cas N = 1** (fréquent : un point d'écoute isolé) : **aucun suffixe `part`**, le fichier s'appelle `{série}.zip`. `partie 1 sur 1` serait une absurdité auto-évidente. Toute l'UI suit : libellés au singulier, pas de « un par un », compteur de volume masqué, phrase « Vigie-Chiro n'accepte pas les fichiers trop volumineux » supprimée (sans objet).
- **Collision** : résolue **au commit**, jamais à l'aperçu — `rename(2)` sur un répertoire cible non vide échoue `ENOTEMPTY` au lieu d'écraser, donc le nom libre ne peut pas être décidé à l'avance sans risquer de perdre 15 minutes de calcul. Boucle sur `EEXIST`/`ENOTEMPTY` avec suffixes `-2` … `-99`, puis `collision-exhausted`. Les volumes portent toujours le nom **avant** suffixe : le dossier porte la distinction, les fichiers n'ont pas à la répéter.

### Découpage en volumes

- **Plafond : 3,5 Gio de zip réel** par volume (`maxVolumeBytes`), surchargeable par `CHIRO_MAX_VOLUME_BYTES` pour un test manuel — valeur **clampée dur** dans `[1 Mio, MAX_UINT32 − 64 Mio]`, entrée invalide ignorée.
- Le plafond porte sur la taille **écrite**, pas sur les octets sources : plafonner la source aurait rempli les volumes au tiers (le WAV compresse à ~36 %). Détails et conséquences dans `architecture.md` § « Série de volumes ».
- **Le nombre de volumes n'est connu qu'à la fin du run.** L'écran de progression affiche `Fichier zip 3` sans total ; la barre, pilotée par les octets sources, reste exacte.
- **Tout ou rien** : abort, erreur, ou complétude de série en échec → le staging est détruit, `upload/` reste vide. Il n'existe jamais de série partielle.
- **Complétude vérifiée à l'exécution** avant le commit : Σ des `entryCount` des volumes `===` nombre d'entrées demandées, **et** égalité ensembliste des noms.

### Écran U-Constat

Identique à A-Constat (mêmes cas bloquants, même pré-check disque) à trois wordings près (dossier `upload` au lieu de `archived`, question de confirmation, pluriel du message d'espace disque). Une action supplémentaire, invisible : le nettoyage des dossiers de staging orphelins d'un run précédent tué (`cleanOrphanStagingDirs`) tourne ici, pendant le « Analyse du dossier… », et jamais pendant le run.

### Écran U-Confirmation

Aperçu (emplacement du dossier de série, taille maximale par fichier) puis exécution en place. Le nom affiché est celui **avant** résolution de collision : la collision se décide au commit, montrer autre chose serait une devinette qui peut se révéler fausse.

**Progression** : mêmes règles qu'A-Confirmation (barre en octets lus en source, ETA byte-weighted, throttle 100 ms, `finalizeRender()` synchrone), plus un compteur de volume. Les événements de chaque volume sont ré-offsetés en **coordonnées globales** — `Enregistrement 214 sur 720` compte sur toute la série, jamais dans le volume courant.

**Ctrl+C pendant le run** : passe par un état **`cleaning`** (« Annulation en cours… ») avant le résultat — la destruction d'un staging de plusieurs Go prend 10 à 60 s sur un disque externe, pendant lesquelles un écran figé serait indiscernable d'un plantage.

**Erreur pendant le run** : reste sur U-Confirmation en variante `run-error`. `Entrée réessayer` n'est proposé que pour les codes **transitoires** (cf. table ci-dessous).

### Écran U-Résultat

Deux variantes :

**Variante A — Succès** : `✓ Terminé !`, nombre d'enregistrements et **nombre réel de fichiers zip**, chemin relatif du dossier de série **réellement obtenu** (il peut porter `-2`), taille totale, temps écoulé, consigne de dépôt (« un par un », l'ordre n'importe pas), incitation à faire aussi une sauvegarde, `📁 cwd` (elle doit pouvoir localiser le dossier dans le Finder), rappel que `processed/` est intact. **Les noms de fichiers ne sont pas listés** : coût en O(N) sur un écran à hauteur fixe, et c'est dans le Finder qu'ils lui servent.

**Variante B — Interruption** : `ℹ Préparation du dépôt arrêtée à votre demande`, `Aucun fichier zip n'a été créé.`, rappel non-destructif.

### États d'erreur — codes

En plus des codes de la table A-Confirmation (tous atteignables ici), le flux de dépôt ajoute :

| Code                   | Cause                                                                                                                                                                            | Transitoire ?  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `zip64-required`       | Un des trois gardes `zip64: "forbid"` s'est déclenché. **Bug interne** — inatteignable tant que le plafond de volume tient (d'où le clamp de l'env).                             | non            |
| `rename-volume:<code>` | Échec du renommage d'un volume en son nom `partN` **à l'intérieur** du staging. Délégué au libellé de `<code>` ; le classement traverse aussi le préfixe.                        | selon `<code>` |
| `verify-failed`        | Complétude de la série en échec, dans un sens ou dans l'autre : une entrée manque, ou le staging contient un fichier que le run n'a pas écrit → staging détruit, `upload/` vide. | oui            |
| `collision-exhausted`  | 99 dossiers de série du même nom déjà présents dans `upload/`.                                                                                                                   | oui            |
| `staging-stuck`        | Un staging d'un essai précédent n'a pas pu être supprimé (droits, verrou). Le réessai relancerait le même nettoyage.                                                             | non            |

`isTransientArchiveError` est la source de vérité : **définitifs** = `zip64-required`, `entry-too-large`, `EROFS`, `staging-stuck` ; tout le reste est transitoire et se voit proposer `Entrée réessayer`. Proposer un réessai qui ne peut structurellement pas aboutir, à quelqu'un qui vient de perdre douze minutes, est la pire fuite de confiance du flux.

Il n'existe **pas** de code `entry-too-large-for-volume` : une entrée plus grosse que le plafond part seule dans son propre volume, qui dépasse alors `maxVolumeBytes()`. C'est délibéré — refuser bloquerait tout le dépôt pour un fichier — et le garde `index > 0` de la boucle d'admission empêche la boucle infinie. La spec a décrit ce code pendant toute la Phase 9 alors qu'il n'a jamais existé dans le code.

Dans **tous** les cas d'échec, y compris interruption, `upload/` ne contient aucune série partielle.

## Wizard "Archiver la sauvegarde en ligne" — 4 écrans (Phase 10)

```
[Menu] → [O-Constat] → [O-Confirmation] → [O-Run] → [O-Résultat] → (retour Menu)
              ↑
[A-Résultat] ─┘  (touche A, en fin du wizard sauvegarde)
```

Envoie le zip le plus récent de `archived/` (produit par le wizard « Sauvegarder les enregistrements découpés ») vers un bucket Scaleway Object Storage en classe `GLACIER`, via `rclone`. **Capacité optionnelle** (cf. `architecture.md` § « Les trois statuts possibles d'un binaire externe ») : deux points d'entrée traversent le **même** constat — l'entrée de menu, et la touche `A` en fin de résultat du wizard sauvegarde. Non-destructif vis-à-vis de `archived/` et de `processed/`. Détails complets d'implémentation dans `architecture.md` § `Module lib/offsite`, wordings exacts dans `ux.md`.

### Visibilité

L'entrée de menu **et** la touche `A` n'existent que si `detectRclone()` trouve un `rclone` ≥ 1.53 (plancher de `lsjson --stat`) **et** `~/.chiro/settings.json` contient un bloc `coffre` valide. Les deux sondes tournent **de façon synchrone dans `index.tsx`, avant `render()`** — jamais dans un `useEffect` de `MenuScreen` — pour éviter la course documentée pour `detectSox` en Phase 9 (un focus posé sur un item avant qu'une 7ᵉ entrée n'apparaisse 100-300 ms plus tard). Absence de l'un ou l'autre → silence total, aucun message, six entrées de menu inchangées.

### Réglages — `~/.chiro/settings.json`

Fichier **lu seulement**, jamais écrit par chiro, édité à la main par la personne qui configure le poste :

```json
{
  "coffre": {
    "remote": "chiro-coffre",
    "bucket": "mon-bucket-scaleway",
    "prefix": "vigie-chiro"
  }
}
```

`remote` doit être un nom de remote rclone **nu** (jamais `remote:bucket` — la présence d'un `:` est rejetée, c'est la faute de frappe la plus probable en recopiant depuis `rclone config`). `prefix` est normalisé (barres obliques de tête/fin retirées) ; un préfixe qui se réduit à vide après normalisation (ex. `"/"`) est rejeté plutôt que traité comme « pas de préfixe ». Toute forme non conforme → `{ kind: "invalid" }`, fichier absent → `{ kind: "absent" }` : les deux se résolvent en « entrée masquée », sans distinction visible pour l'utilisatrice.

### Écran O-Constat

Deux phases : sélection du fichier local, puis HEAD distant. `pickArchiveToUpload` choisit le zip le **plus récent par mtime** dans `archived/` (au format de nommage du wizard sauvegarde) et compte les autres. `remoteStat` interroge ensuite `<remote>:<bucket>/<prefix>/<nom-du-zip>` via `rclone lsjson --stat`.

**Détection « déjà en ligne » : HEAD distant systématique, jamais une relecture du journal.** `sessions.jsonl` reste write-only comme pour les deux flux zip — la raison est plus forte ici qu'ailleurs : `buildArchiveName` retombe sur le préfixe `"processed"` quand `extractCommonPrefix` ne trouve rien de commun, et le journal est global (`~/.chiro`) alors que le nom du zip est local à un dossier. Deux études traitées le même jour dans deux dossiers différents produiraient toutes deux `processed_20260817.zip` ; une détection par journal aurait affiché « déjà archivée » pour un zip jamais envoyé — le pire échec possible pour une fonction de sauvegarde, silencieux et indiscernable d'un succès.

Cas bloquants/informatifs, tous couverts par un état dédié :

| État                         | Cause                                                                     |
| ---------------------------- | ------------------------------------------------------------------------- |
| `no-backup`                  | Aucun zip de sauvegarde dans `archived/`                                  |
| `scan-error`                 | Erreur `readdir`/`stat` autre qu'`ENOENT` sur `archived/`                 |
| `ready`                      | Zip local trouvé, absent du bucket                                        |
| `already-online`             | Zip local trouvé, présent au bucket à la **même** taille                  |
| `size-mismatch`              | Zip local trouvé, présent au bucket à une taille **différente**           |
| `verify-error` (transitoire) | `remoteStat` n'a pas pu répondre (réseau, timeout)                        |
| `verify-error` (définitif)   | `bucket-missing` / `config-error` — réglage cassé, pas un problème réseau |

`remoteStat` borne elle-même son temps de blocage (`--retries 1 --low-level-retries 1 --contimeout 10s --timeout 30s`, `AbortSignal`, kill dur) : sans ça, les valeurs par défaut de rclone (`--retries 3 --low-level-retries 10`) pourraient figer l'écran plusieurs minutes sur un réseau mort, pendant lesquelles le Ctrl+C global de l'app est avalé (`runningRef`) — l'`AbortController` local à l'écran est alors la seule sortie.

### Écran O-Confirmation

Aperçu (nom, taille, durée prévue) puis exécution en place — pas d'écran intermédiaire. La durée prévue vient de `estimateUploadSeconds` (calibré sur 30 Mb/s, volontairement pessimiste — dépasser l'estimation est la mauvaise direction). `pmset -g batt` (macOS uniquement) est lu une fois au montage ; sur batterie, un bloc d'avertissement s'ajoute mais `Entrée` reste possible.

### Le transfert — `uploadArchive`

```bash
rclone copyto <local> <remote>:<bucket>/<prefix>/<nom> \
  --s3-storage-class GLACIER --s3-chunk-size 64Mi --s3-upload-concurrency 8 \
  --low-level-retries 20 --retries 3 \
  --use-json-log --stats 1s --stats-log-level NOTICE
```

Sur darwin, la commande est **préfixée** par `caffeinate -i -s` (cf. `architecture.md` § `lib/offsite`) — jamais spawnée en second process séparé. `--low-level-retries 20` absorbe les micro-coupures **sans** repartir de zéro ; `--retries 3` reprend l'objet entier jusqu'à 3 fois — personne n'est là pour appuyer sur « réessayer » à 3 h du matin, et le transfert entrant est gratuit chez Scaleway.

**Contrat de progression** — `totalBytes` et `eta` de rclone sont **entièrement ignorés** (mesurés faux sur trace réelle, cf. `architecture.md` § `lib/offsite`). Le dénominateur est la taille locale du fichier, déjà connue avant le run ; le numérateur est `transferring[0]?.bytes ?? stats.bytes`, clampé **monotone** (un retry ne fait jamais reculer la barre).

**Abandon (Ctrl+C)** — `signal` déclenche un SIGINT immédiat. rclone répond par son propre code de sortie `130`, sans tick final. `uploadArchive` escalade seul, automatiquement : un second SIGINT après `sigintResendMs` (5 s par défaut) si le premier a été ignoré, un SIGKILL dur après `killEscalationMs` (15 s). SIGINT plutôt qu'un SIGKILL immédiat : un SIGKILL laisse les parts multipart en vol, **facturées** et jamais nettoyées par chiro ; un SIGINT donne à rclone la chance de les abandonner proprement.

**La course qui ne doit pas se perdre** : rclone peut sortir `0` dans la fenêtre entre la demande d'abandon et l'arrivée effective du signal — l'objet est alors réellement dans le bucket. Après un abandon, le code de sortie est donc **quand même** consulté : `0` reste un succès. Annoncer « annulé » sans rien journaliser ferait re-proposer l'envoi complet d'un objet déjà présent.

**Vérification post-transfert** — sur un exit `0`, `remoteStat` est appelé une seule fois de plus :

- taille distante = taille locale → `verified: "size-match"` (succès).
- objet présent à une taille **différente** → `verify-failed` (erreur — l'upload a réellement échoué à produire l'objet attendu, un cas distinct du « déjà en ligne, taille différente » du Constat, qui compare deux objets **antérieurs**).
- objet **absent** → `verify-absent` (erreur — le magasin a répondu, et sa réponse est non ; la cause réaliste est une clé mal construite).
- aucune réponse (réseau, timeout, config) → `verified: "unavailable"` (**succès quand même** — l'échec de la revérification n'est pas la preuve que l'envoi a échoué).

### Écran O-Résultat

Trois issues, jamais de branche « erreur » distincte de l'écran de run — `run-error` se rend **sur place**, sans changer d'écran, pour permettre un réessai sans repasser par le Constat :

- **succès** — `verified: "size-match" | "unavailable"`, heure de fin **et** durée.
- **`aborted`** — rclone a effectivement quitté sur son propre code d'annulation (`130`).
- **`run-error`** — code brut mappé via `errorMessages.ts` ; `Entrée réessayer` uniquement pour les codes transitoires.

### Schéma v6 — sessions `vigie-upload` (Phase 10)

`schema_version: 6`, `action: "vigie-upload"`. Même patron que v4/v5 : pas de champ `input` (rien que l'utilisatrice choisit), `result` discriminé sur `status`. **Write-only comme v3/v5** : l'événement documente ce qui s'est passé, il n'est **jamais relu** — la détection « déjà en ligne » interroge le coffre directement (§ O-Constat ci-dessus), pas ce journal.

```json
{
  "schema_version": 6,
  "ts": "2026-08-17T23:11:06.004Z",
  "version": "0.6.0",
  "cwd": "/Users/.../Vigie-2026-A1",
  "action": "vigie-upload",
  "result": {
    "status": "ok",
    "zip_name": "Car340581-2026-Pass1-A1_20260814.zip",
    "zip_bytes": 933232640,
    "remote": "chiro-coffre",
    "bucket": "mon-bucket-scaleway",
    "remote_key": "vigie-chiro/Car340581-2026-Pass1-A1_20260814.zip",
    "verified": "size-match",
    "attempts": 1,
    "duration_ms": 4320000
  }
}
```

`OffsiteResultSerialized` (`src/types.ts`) — union discriminée sur `status` :

- `"ok"` → `zip_name`, `zip_bytes`, `remote`, `bucket`, `remote_key`, `verified: "size-match" | "unavailable"`, `attempts` (compte les `--retries` complets de rclone pour cet objet, pas les `--low-level-retries` internes à une tentative), `duration_ms`.
- `"aborted"` → `zip_name`, `zip_bytes`, `bytes_sent`, `duration_ms`.
- `"error"` → `error_code` (le code brut, pas le libellé français), `zip_name`, `zip_bytes`, `bytes_sent`, `duration_ms`.

`duration_ms` mesure la **tentative complète** côté orchestrateur (`useOffsiteRun`), pas le seul temps passé dans `uploadArchive` — même raison que pour v4/v5 : c'est la seule façon d'avoir une durée pour un run interrompu ou en échec.

**`vigie-upload` était délibérément resté libre en Phase 9** (`buildPackageSessionEvent` utilise `vigie-package`, pas `vigie-upload`, pour la même raison que le nom l'indique : préparer des volumes n'est pas déposer). C'est ce nom qu'utilise la Phase 10, exactement comme prévu.

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

### Schéma v5 — sessions `vigie-archive` (Phase 8, révisé)

`schema_version: 5`, `action: "vigie-archive"`. **Pas de champ `input`** : le flow zip n'a rien que l'utilisatrice choisisse. `result` est une **union discriminée sur `status`** — `ok` seul porte le nom, la taille du zip produit et `durable`, mais les trois variantes portent les compteurs connus avant le run, pour qu'un échec reste diagnosticable :

```json
{
  "schema_version": 5,
  "ts": "2026-08-13T15:44:12.004Z",
  "version": "0.4.0",
  "cwd": "/Users/.../Vigie-2026-A1",
  "action": "vigie-archive",
  "result": {
    "status": "ok",
    "zip_name": "processed_202608131544.zip",
    "entry_count": 720,
    "total_bytes": 1503238553,
    "zip_bytes": 541165879,
    "duration_ms": 54120,
    "durable": true
  }
}
```

- `status: "aborted"` → `entry_count`, `total_bytes`, `duration_ms`.
- `status: "error"` → idem + `error_code` (le code brut, pas le libellé français).

`duration_ms` mesure la **tentative complète** côté orchestrateur (`useArchiveRun`), pas le seul temps passé dans `createZipArchive` — c'est la seule façon d'avoir une durée pour les runs interrompus ou en échec.

### Schéma v4 — sessions `vigie-package` (Phase 9)

`schema_version: 4`, `action: "vigie-package"`. Même forme que v3 (pas d'`input`, `result` discriminé sur `status`), enrichie de ce qui est propre à une série. Le nom de l'action dit ce que chiro fait réellement : il **prépare** des fichiers, il ne dépose rien — `vigie-upload` reste délibérément libre pour un futur upload Glacier.

```json
{
  "schema_version": 4,
  "ts": "2026-08-14T15:44:12.004Z",
  "version": "0.5.0",
  "cwd": "/Users/.../Vigie-2026-A1",
  "action": "vigie-package",
  "result": {
    "status": "ok",
    "series_dir": "Car340581-2026-Pass1-A1_20260814",
    "volume_count": 3,
    "volumes": [
      {
        "name": "Car340581-2026-Pass1-A1_20260814_part1.zip",
        "entry_count": 241,
        "zip_bytes": 3758096000
      }
    ],
    "max_volume_bytes": 3758096384,
    "entry_count": 720,
    "total_bytes": 15032385536,
    "duration_ms": 954120,
    "durable": true
  }
}
```

- `volumes` est **borné à 50 entrées** (un `CHIRO_MAX_VOLUME_BYTES` bas, posé pour un test manuel, peut produire des dizaines de volumes et la ligne JSONL n'a pas à grossir avec). `volume_count` reste le compte réel, non tronqué.
- `max_volume_bytes` enregistre le plafond réellement en vigueur pour ce run — c'est ce qui rend un log lisible après un test manuel avec override.
- `durable` reflète le succès des `fsync` de répertoire (best-effort). Un futur flux destructif devra l'exiger à `true`.
- `status: "aborted"` → `max_volume_bytes`, `entry_count`, `total_bytes`, `duration_ms`.
- `status: "error"` → idem + `error_code` (le code brut, pas le libellé français).

`schema_version` est un identifiant de **forme d'événement** (une par `action`), pas un compteur de révision : v3 et v4 étaient deux actions différentes ajoutées coup sur coup, pas deux révisions du même événement.

**v3 est retiré, remplacé par v5.** Le flux sauvegarde continue d'écrire `vigie-archive`, mais sa forme a gagné `durable` — donc, exactement comme la règle ci-dessus l'exige, un **nouveau numéro** plutôt qu'un champ ajouté à v3 (et surtout pas un « v3.1 »). Les entrées v3 déjà sur disque gardent leur forme ; rien ne les relit — `SessionEvent` est un type d'**écriture**, il liste les formes que chiro émet aujourd'hui. La raison du numéro neuf est étroite et suffisante : une ligne portant `schema_version: 5` a exactement les champs que v5 déclare, donc tout consommateur aval (jq, un futur export) branche sur le numéro au lieu de sonder la présence d'un champ.

## Versioning

- `chiro --version` lit la version dans `package.json` (bundled au moment du `bun build --compile`).
- La version est aussi loggée dans chaque entrée du log local.
- Schéma : SemVer (`0.1.0` au MVP).

## Cas dégradés — checklist exhaustive

| Cas                                                       | Comportement attendu                                                                                                                       | Écran                       |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| Pas de TTY                                                | Message stderr + quit code 1                                                                                                               | Avant Ink                   |
| `--version`                                               | Affiche version + quit code 0                                                                                                              | Avant Ink                   |
| `--help`                                                  | Affiche help + quit code 0                                                                                                                 | Avant Ink                   |
| Dossier vide                                              | "Aucun fichier .wav trouvé" + chemin affiché                                                                                               | Constat                     |
| Aucun `.wav` (mais d'autres fichiers)                     | Idem                                                                                                                                       | Constat                     |
| Tous les `.wav` déjà préfixés                             | Constat passe normalement → Saisie → Confirmation affiche 0 renommage prévu → l'utilisatrice peut quand même valider → Résultat variante B | Tous les écrans             |
| Dossier non lisible (`R_OK` KO)                           | Message + quit                                                                                                                             | Constat                     |
| Dossier non writable (`W_OK` KO)                          | Message + bouton retour                                                                                                                    | Constat                     |
| Erreur inattendue au scan FS                              | Écran Constat affiche le code brut + invite à fermer apps concurrentes                                                                     | Constat                     |
| `.WAV` majuscule                                          | Normalisé en `.wav` dans le nom cible                                                                                                      | Renommage                   |
| Collision avec fichier existant                           | Affichage Confirmation + skip Renommage                                                                                                    | Confirmation + Résultat     |
| `EXDEV` cross-device                                      | Fallback `copyFile + unlink` transparent                                                                                                   | Renommage                   |
| `EACCES` / `EPERM` sur un fichier                         | Consigner, continuer                                                                                                                       | Renommage                   |
| `ENOENT` (fichier supprimé entre scan et rename)          | Consigner, continuer                                                                                                                       | Renommage                   |
| Caractères exotiques (accents, espaces, emojis) dans noms | Aucun traitement spécial, Node gère                                                                                                        | Toujours                    |
| Symlinks dans le dossier                                  | Ignorés au scan                                                                                                                            | Constat                     |
| Ctrl+C pendant la saisie                                  | Quit immédiat code 130                                                                                                                     | Toutes                      |
| Ctrl+C pendant le renommage                               | Stop propre, Résultat variante D                                                                                                           | Renommage → Résultat        |
| Terminal redimensionné en cours                           | Ink gère ; aucun traitement spécial requis                                                                                                 | Toutes                      |
| Pas de `processed/` au flow zip                           | Message informatif + deux causes (découpage pas fait / mauvais dossier)                                                                    | A-Constat                   |
| `processed/` sans fichier archivable                      | « ne contient aucun enregistrement » + guidance découpage interrompu                                                                       | A-Constat                   |
| `cwd` non writable au flow zip                            | Message « impossible de créer le sous-dossier archived » (ou « upload » selon le flux)                                                     | A-Constat / U-Constat       |
| Espace disque insuffisant pour le zip                     | Chiffres requis/dispo + rappel qu'un zip est une copie                                                                                     | A-Constat                   |
| Zip du même jour déjà présent                             | Suffixe `-2`…`-99`, aucun écrasement                                                                                                       | A-Confirmation              |
| Dossier de série du même jour déjà présent                | Résolu **au commit** : suffixe `-2`…`-99` sur le dossier, volumes inchangés                                                                | U-Confirmation              |
| Ctrl+C pendant la création de la série                    | État `cleaning` (« Annulation en cours… ») puis U-Résultat interruption ; `upload/` reste vide                                             | U-Confirmation → U-Résultat |
| Staging caché orphelin d'un run tué (`kill -9`)           | Nettoyé au constat suivant si PID mort **ou** plus vieux que 24 h                                                                          | U-Constat                   |
| Lot ne tenant pas en un seul volume                       | Bascule automatique de volume, nombre de fichiers annoncé seulement au résultat                                                            | U-Confirmation → U-Résultat |
| Lot tenant en un seul volume (N = 1)                      | Aucun suffixe `part`, libellés au singulier, compteur de volume masqué                                                                     | U-Confirmation → U-Résultat |
| Fichier source modifié / supprimé pendant le zip          | `file-changed` → `.tmp` supprimé, aucun zip produit                                                                                        | A-Confirmation              |
| Disque plein pendant le zip                               | `ENOSPC` (souvent au `sync()`) → `.tmp` supprimé, aucun zip produit                                                                        | A-Confirmation              |
| Zip écrit mais vérification en échec                      | `verify-failed` → `.tmp` supprimé, rien dans `archived/`                                                                                   | A-Confirmation              |
| Ctrl+C pendant la création du zip                         | Abort, `.tmp` supprimé, Résultat variante interruption                                                                                     | A-Confirmation → A-Résultat |
| `.tmp` orphelins d'un run précédent tué                   | Nettoyés au run suivant si le PID embarqué ne tourne plus                                                                                  | A-Confirmation              |
