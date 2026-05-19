# UX — Wordings et conventions visuelles

Ce document est la source de vérité pour **tous les libellés affichés** et les **conventions visuelles Ink**. Les valeurs ci-dessous sont prêtes à coller dans le code. Ne pas reformuler sans relecture du fichier `vision.md` (utilisatrice non-tech, ton bienveillant).

## Conventions visuelles globales

### Couleurs (toutes via les props `color` / `backgroundColor` d'Ink)

| Usage                                            | Couleur Ink                 | Pourquoi                                             |
| ------------------------------------------------ | --------------------------- | ---------------------------------------------------- |
| Succès, validation                               | `green`                     | Standard                                             |
| Avertissement non-bloquant, skip, collision      | `yellow`                    | Standard                                             |
| Erreur, validation invalide                      | `red`                       | Standard                                             |
| Valeur saisie par l'utilisatrice (mise en avant) | `cyan`                      | Non-anxiogène                                        |
| Aide contextuelle, raccourcis footer             | `dimColor` (prop booléenne) | Discret, **jamais `gray`** (invisible sur Solarized) |
| Chemins de fichiers, valeurs exemples            | `cyan` ou texte brut        | Lisible                                              |

### Caractères Unicode (utilisés en début de ligne pour scanabilité)

- `✓` — succès
- `⚠` — avertissement
- `ℹ` — info neutre
- `📁` — dossier
- `→` — transition (avant → après)
- `•` — puce de liste (jamais `-` ou `*`)
- `█` `░` — barre de progression (run Découper)

**Pas d'autres emojis décoratifs** dans les libellés. On garde ces 7.

### Layout général

- **Bordure principale** : `borderStyle="round"` autour de la zone de contenu.
- **Largeur fixe** : `width={70}` sur la zone centrale. Stabilise le rendu quel que soit le terminal.
- **Footer raccourcis** : séparé par `borderTop`, sans bordures latérales. Couleur `dimColor`.
- **Espacement** : `marginY={1}` entre blocs principaux, `marginTop={1}` avant footer. Pas plus — l'écran tient en 80×24.
- **Pas de bordure** autour de chaque champ de formulaire (bruit visuel).

### Footer raccourcis

Chaque écran a son footer adapté. Format type :

```
  ↑↓ champ   ←→ ajuster   Entrée valider   Échap retour
```

Couleur : `dimColor`. Séparateur : 3 espaces (pas de pipe `|`).

**Cas particuliers** :

- **Sur les écrans dégradés (constat KO)**, le footer n'affiche que `Échap retour au menu`.
- **Sur l'écran de Confirmation pendant l'exécution du renommage**, le footer est vide (Ctrl+C reste fonctionnel mais on ne l'affiche pas pour éviter les abandons accidentels).

## Navigation clavier — référence

| Touche            | Action                                                                              | Affichée en footer ?       |
| ----------------- | ----------------------------------------------------------------------------------- | -------------------------- |
| `Tab` / `Maj+Tab` | Champ suivant / précédent (FormScreen) — alias de `↓` / `↑`                         | Non (redondant avec `↑↓`)  |
| `↑` / `↓`         | Naviguer dans le menu, ou entre les champs du formulaire                            | MenuScreen, FormScreen     |
| `←` / `→`         | Décrémenter / incrémenter un champ numérique (Année, Passage)                       | Oui sur FormScreen         |
| `Entrée`          | Valider l'écran courant (sur UpdateScreen : uniquement quand une version est dispo) | Toujours                   |
| `Échap`           | Revenir à l'écran précédent (ou quitter depuis Menu)                                | Toujours sauf Résultat     |
| `Ctrl+C`          | Quitter immédiatement (sauf pendant un renommage en cours ou un check update)       | Implicite — jamais affiché |

## Wordings par écran — prêts à coller

### Écran 0 — Menu

```
chiro — outils Vigie-Chiro

Que voulez-vous faire ?

  ▸ Préfixer des enregistrements pour Vigie-Chiro
    Découper les enregistrements (pour Tadarida)
    Vérifier les mises à jour
    Quitter

  ↑↓ choisir   Entrée valider   Échap quitter
```

Item sélectionné préfixé par `▸ ` (avec un espace). Items non sélectionnés alignés sur la même colonne (`  ` deux espaces).

**Variante — auto-check au boot a trouvé une nouvelle version** : entre la liste d'items et le footer, afficher en `color="yellow"` :

```
chiro — outils Vigie-Chiro

Que voulez-vous faire ?

  ▸ Préfixer des enregistrements pour Vigie-Chiro
    Découper les enregistrements (pour Tadarida)
    Vérifier les mises à jour
    Quitter

  ⚠ Une mise à jour est disponible (v0.2.0).
    Choisissez « Vérifier les mises à jour » pour l'installer.

  ↑↓ choisir   Entrée valider   Échap quitter
```

L'auto-check est silencieux : si le réseau échoue ou que la version locale est à jour, le hint n'apparaît jamais. La seconde ligne en `dimColor` indique l'action à faire. Cache disque de 6 h sur `~/.chiro/update-check.json` pour ménager le rate-limit GitHub.

### Écran 1 — Constat (nominal)

```
📁 /Users/.../Vigie-2026-pointA1

✓ 8 enregistrements .wav trouvés ici
  • 1 fichier déjà au bon format sera laissé tel quel
  • 2 autres fichiers seront ignorés (pas des .wav)

Ce sont bien les fichiers à préparer ?

  Entrée continuer   Échap retour au menu
```

**Variantes** :

- Aucun fichier déjà préfixé / aucun fichier ignoré → ne pas afficher les puces correspondantes.
- Présence de `.WAV` majuscule : remplacer la puce ignorée par :
  ```
  • 2 fichiers en .WAV seront renommés en .wav (minuscule)
  ```

### Écran 1 — Constat (dégradé : dossier vide / pas de .wav)

```
📁 /Users/.../Documents

Aucun enregistrement .wav trouvé dans ce dossier.

Vérifiez que vous êtes bien dans le dossier contenant vos fichiers.
Astuce : dans le Terminal, tapez `pwd` pour voir où vous êtes,
ou `ls` pour voir les fichiers présents.

  Échap retour au menu
```

### Écran 1 — Constat (dégradé : dossier non writable)

```
📁 /Users/.../Données-protégées

⚠ Ce dossier est protégé en écriture.

L'outil ne peut pas renommer les fichiers ici. Essayez de :
  • copier les fichiers dans un dossier de votre choix
  • puis relancer chiro dans ce nouveau dossier

  Échap retour au menu
```

### Écran 1 — Constat (dégradé : dossier non lisible)

```
📁 /Users/.../Dossier-inaccessible

⚠ Ce dossier ne peut pas être lu.

Cela peut arriver si :
  • vous n'avez pas les permissions (essayez un autre dossier)
  • le dossier est en cours d'utilisation par une autre application

  Échap retour au menu
```

### Écran 1 — Constat (dégradé : erreur inattendue au scan)

```
📁 /Users/.../Dossier-en-cours

⚠ Une erreur inattendue est survenue en lisant ce dossier.

Détail technique : {CODE_BRUT}
(à transmettre si vous demandez de l'aide)

Essayez de fermer les autres applications qui pourraient
utiliser ce dossier, puis relancez chiro.

  Échap retour au menu
```

`{CODE_BRUT}` = le `code` du throw `fs` (ex `EBUSY`, `EIO`, `EMFILE`…).

### Écran 2 — Saisie

Formulaire vertical. Pour chaque champ : label en haut, input en dessous, aide en `dimColor` indentée de 2 espaces sous l'input, erreur (si présente) en `red` à la place de l'aide.

**Champ Carré**

```
Code du carré
  ┌──────────────┐
  │ 040962       │
  └──────────────┘
  Le numéro à 6 chiffres visible sur la page de votre site
  Vigie-Chiro. Si le département commence par 1-9, ajoutez un 0
  devant (ex : 040962 pour les Landes).
```

- Erreur si invalide :
  - `Il faut exactement 6 chiffres (vous en avez tapé 4).`
  - `Le code ne doit contenir que des chiffres.`

**Champ Année** (pré-rempli)

```
Année de la session
  ┌──────┐
  │ 2026 │
  └──────┘
  Pré-remplie sur cette année. Modifiable si besoin.
```

- Erreurs :
  - `L'année doit être sur 4 chiffres (ex : 2026).`
  - `L'année doit être comprise entre 1900 et 2100.`

**Champ Passage** (pré-rempli)

```
Numéro de passage
  ┌───┐
  │ 1 │
  └───┘
  Combien de fois vous êtes déjà passée sur ce point cette année ?
  (1 pour le premier passage, 2 pour le deuxième, etc.)
```

- Erreurs :
  - `Le passage doit être un nombre entier supérieur ou égal à 1.`

**Champ Code du point**

```
Code du point d'écoute
  ┌────┐
  │ A1 │
  └────┘
  Une lettre suivie d'un chiffre, comme indiqué sur votre plan
  de carré (A1, B2, C3...).
```

- Erreur :
  - `Format attendu : une lettre puis un chiffre (ex : A1).`

**Validation hybride** :

- **Pendant la frappe** : silence total. Aucun rouge, aucun compteur de progression.
- **À la sortie du champ** (`↑`/`↓` ou `Tab`/`Shift+Tab`) ou à la **soumission** (Entrée) : la validation se déclenche. Si invalide, message en rouge à la place de l'aide.
- **Quand le champ devient valide** : afficher un `✓` discret en `dimColor` à droite du champ. Pas de compteur.
- **Sur le code du point d'écoute saisi en lowercase** (ex `a1`) : au blur, afficher en `dimColor` `sera enregistré en A1` à la place de l'aide.

**Champs numériques (Année, Passage)** :

- Rendus sans curseur (texte brut).
- `←` / `→` décrémentent / incrémentent la valeur, clampée à `[1900, 2100]` (Année) et `[1, 9999]` (Passage).
- Saisie au clavier également possible (chiffres ajoutés à droite, tronqués à la longueur max ; Backspace supprime le dernier chiffre).

**Soumission** :

**Entrée = toujours tenter la soumission**. `↑`/`↓` (ou `Tab`/`Shift+Tab`) uniquement pour naviguer entre champs. Si la soumission échoue (champs invalides), la validation se déclenche sur **tous** les champs (affichant toutes les erreurs en même temps) et le focus va sur le 1er champ invalide.

**Focus initial** : Au montage du formulaire, le focus est sur le champ Carré (1er champ vide ; Année et Passage sont préremplis avec des valeurs valides).

**Footer** :

```
  ↑↓ champ   ←→ ajuster   Entrée valider   Échap retour
```

### Écran 3 — Confirmation (nominal)

```
📁 /Users/.../Vigie-2026-pointA1

On va renommer 7 fichiers comme ceci :

  20260511_213045.wav  →  Car040962-2026-Pass3-A1-20260511_213045.wav
  20260511_220011.wav  →  Car040962-2026-Pass3-A1-20260511_220011.wav
  20260512_023322.wav  →  Car040962-2026-Pass3-A1-20260512_023322.wav

  Les 4 autres suivent le même format (seul l'horodatage change).

ℹ 1 fichier sera laissé tel quel (déjà au bon format) :
    Car040962-2026-Pass3-A1-old.wav

Le nom original est conservé en fin du nouveau nom — rien n'est perdu,
vous pouvez retrouver chaque fichier à partir de sa fin.

  Entrée renommer   Échap modifier la saisie
```

**Variantes** :

- Si N ≤ 3 : afficher les N exemples, supprimer la ligne `Les X autres suivent le même format`.
- Si aucun fichier déjà préfixé : supprimer le bloc `ℹ ... laissé tel quel`.
- Si collisions détectées :
  ```
  ⚠ 2 fichiers ne pourront pas être renommés (un fichier porte
    déjà le nom cible) :
      foo.wav
      bar.wav
  ```
  Inséré AVANT la phrase de réassurance.

### Écran 3 — Confirmation (cas "0 fichier à renommer, tout est déjà préfixé")

```
ℹ Tous les fichiers (8) sont déjà au bon format.

Rien à renommer. Vous pouvez retourner au menu.

  Entrée retour au menu   Échap retour à la saisie
```

### Écran 4 — Résultat (variante A : tout OK)

```
✓ Terminé !

  7 fichiers renommés avec le préfixe
      Car040962-2026-Pass3-A1-
  1 fichier laissé tel quel (déjà au bon format)

Vous pouvez maintenant les téléverser sur Vigie-Chiro.

  Entrée retour au menu
```

### Écran 4 — Résultat (variante B : rien à faire)

```
✓ Rien à faire — tout est déjà au bon format.

  8 fichiers déjà nommés correctement.

  Entrée retour au menu
```

### Écran 4 — Résultat (variante C : erreurs partielles)

```
⚠ Renommage terminé avec X souci(s)

  N fichiers renommés ✓

  X fichiers n'ont pas pu être renommés :

    • permission refusée par le système (3 fichiers)
        foo.wav
        bar.wav
        baz.wav

    • le fichier a disparu pendant l'opération (1 fichier)
        qux.wav

Les autres fichiers ont bien été renommés.

  Entrée retour au menu
```

Si > 5 fichiers du même code d'erreur, tronquer à 5 + `... et X autres`.

Codes d'erreur → libellés :

| Code               | Libellé                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `EEXIST`           | `un fichier portant le nom cible existe déjà — non remplacé`                                                      |
| `EACCES` / `EPERM` | `permission refusée par le système`                                                                               |
| `ENOENT`           | `le fichier a disparu pendant l'opération`                                                                        |
| `DUPLICATED*`      | `le fichier a été copié mais l'original n'a pas pu être supprimé — vérifiez manuellement et supprimez le doublon` |
| autre              | `erreur inattendue (code: XXX)`                                                                                   |

### Écran 4 — Résultat (variante D : interruption Ctrl+C)

```
ℹ Renommage arrêté à votre demande

  3 fichiers déjà renommés (conservés en sécurité)
  Il restait 5 fichiers à traiter.

Vous pouvez relancer chiro à tout moment — les fichiers déjà
renommés seront reconnus et ne seront pas touchés deux fois.

  Entrée retour au menu
```

### Écran 5 — Mise à jour (installation Homebrew détectée)

Quand chiro tourne depuis une install Homebrew (détecté via `isHomebrewInstall`) OU que `CHIRO_DISABLE_AUTOUPDATE=1` est posé, l'auto-check au boot est désactivé et l'entrée « Vérifier les mises à jour » est masquée du MenuScreen. Cet écran reste implémenté en garde défensive (au cas où un appel parviendrait par un chemin non prévu) et affiche :

```
chiro v0.1.0 — mise à jour

ℹ chiro a été installé via Homebrew sur cet ordinateur.

Les mises à jour passent donc par Homebrew.
Dans votre terminal, lancez :

    brew upgrade chiro

  Échap retour au menu
```

- `ℹ` couleur par défaut (info neutre, ni succès ni avertissement).
- `brew upgrade chiro` en `bold color="cyan"` — cohérent avec la convention "valeur/commande à copier" (cf. table couleurs).
- Aucun `useEffect` réseau, aucun `runningRef.current = true` — early-return JSX avant les side-effects.

### Écran 5 — Mise à jour (vérification en cours)

```
chiro v0.1.0 — mise à jour

Vérification de la dernière version…

  Échap retour au menu
```

Header en `bold cyan` comme l'écran Menu. Pendant cet état, le Ctrl+C global est désactivé (via `runningRef`) pour ne pas tuer le fetch en plein milieu — l'utilisatrice peut toujours sortir avec Échap.

### Écran 5 — Mise à jour (nouvelle version disponible)

```
chiro v0.1.0 — mise à jour

✓ Une nouvelle version est disponible : v0.2.0

Sur Entrée, chiro lance l'installation puis se ferme.
Relancez chiro ensuite pour utiliser la nouvelle version.

  Entrée installer   Échap retour au menu
```

- `✓` en `color="green"`, `v0.2.0` en `color="cyan"`.
- Avertissement explicite **avant** Entrée — principe "lire ce qui va se passer avant que ça se passe".
- Sur Entrée : `onRequestInstall()` qui pose un drapeau au boot (cf. `architecture.md`), puis `useApp().exit()`. Après que Ink ait unmount, `install.sh` est exécuté via `node:child_process` `spawnSync` avec stdio hérités — l'utilisatrice voit ensuite directement `Téléchargement de chiro…` du script.

### Écran 5 — Mise à jour (déjà à jour)

```
chiro v0.1.0 — mise à jour

✓ Vous êtes à jour.

  Échap retour au menu
```

### Écran 5 — Mise à jour (erreur — message générique)

```
chiro v0.1.0 — mise à jour

⚠ Impossible de vérifier la dernière version.

Vérifiez votre connexion internet, puis réessayez.
Détail technique : délai dépassé (timeout)
  (à transmettre si vous demandez de l'aide)

  Échap retour au menu
```

- Codes concernés : `network`, `timeout`, `http-404`, `parse`, `parse-local`.
- `⚠` en `color="yellow"`.
- Le détail technique est affiché en clair (avec `dimColor` sur la ligne "à transmettre") — c'est précieux quand l'utilisatrice contacte le support.

### Écran 5 — Mise à jour (erreur — rate-limit GitHub)

```
chiro v0.1.0 — mise à jour

⚠ GitHub bloque temporairement les vérifications.

C'est normal si vous lancez chiro très souvent.
Réessayez dans une heure.
Détail technique : quota GitHub atteint (http-403)
  (à transmettre si vous demandez de l'aide)

  Échap retour au menu
```

Message dédié pour `http-403` — la connexion fonctionne, c'est GitHub qui rate-limite (60 req/h non-authentifié).

### Codes d'erreur Update → libellés FR

| Code          | Titre principal                                 | Astuce contextuelle                                                       | Détail technique         |
| ------------- | ----------------------------------------------- | ------------------------------------------------------------------------- | ------------------------ |
| `network`     | Impossible de vérifier la dernière version.     | Vérifiez votre connexion internet, puis réessayez.                        | pas de connexion         |
| `timeout`     | Impossible de vérifier la dernière version.     | Vérifiez votre connexion internet, puis réessayez.                        | délai dépassé            |
| `http-403`    | GitHub bloque temporairement les vérifications. | C'est normal si vous lancez chiro très souvent. Réessayez dans une heure. | quota GitHub atteint     |
| `http-404`    | Impossible de vérifier la dernière version.     | Aucune version publiée. Contactez le développeur.                         | aucune version publiée   |
| `parse`       | Impossible de vérifier la dernière version.     | Réessayez ; si le problème persiste, contactez le développeur.            | réponse inattendue       |
| `parse-local` | Impossible de comparer les versions.            | Réinstallez chiro depuis le site.                                         | version locale illisible |

## Boot — messages hors-Ink (stderr / stdout)

### `chiro --version`

```
chiro 0.1.0
```

### `chiro --help`

```
chiro — outils Vigie-Chiro

  Lancez `chiro` sans argument dans un dossier contenant vos
  enregistrements .wav. Une interface interactive vous guide.

  Options :
    --version, -v   Affiche la version
    --help, -h      Affiche cette aide
```

### Pas de TTY détecté

```
chiro doit être lancé dans un terminal interactif.
(Pas de TTY détecté — la sortie a probablement été redirigée.)
```

→ stderr, quit code 1.

### Argument inattendu

```
chiro ne prend pas encore d'argument. Lancez simplement `chiro`
dans un dossier d'enregistrements .wav.
```

→ stderr, quit code 0 (on ne traite pas ça comme une erreur dure).

## Wordings — Flow « Découper les enregistrements » (Phase 5)

### P-Constat (nominal)

```
📁 /Users/.../Vigie-2026-pointA1

✓ 12 enregistrements .wav prêts à découper
  Volume total : 1.4 Go

Ce sont bien les fichiers à découper ?

  Entrée continuer   Échap retour au menu
```

Le « volume total » donne à l'utilisatrice un ordre de grandeur (utile pour les sessions AudioMoth où chaque fichier fait 150 Mo). Pas de comptage de « déjà au format » côté Constat — le filtre `_NNN.wav$` se déclenche silencieusement à l'exécution.

### P-Constat (dégradé : `processed/` existe déjà)

`color="yellow"` (warning **non-bloquant** au sens UX : on guide vers la solution, on ne crie pas).

```
📁 /Users/.../Vigie-2026-pointA1

⚠ Un dossier « processed » existe déjà ici.

Pour éviter de mélanger les anciens et les nouveaux découpages,
chiro ne va pas écrire par-dessus. Vous pouvez :
  • renommer l'ancien dossier (par ex. « processed-ancien »)
  • ou le supprimer s'il ne vous sert plus

Puis relancez chiro dans ce dossier.

  Échap retour au menu
```

**Important** : on propose « renommer » **avant** « supprimer » — moins anxiogène pour une non-tech. Pas d'option « écraser » dans l'UI ; le principe non-destructif l'interdit.

### P-Constat (dégradé : espace disque insuffisant)

```
📁 /Users/.../Vigie-2026-pointA1

⚠ Pas assez d'espace disque pour cette opération.

  Espace requis : ~1.5 Go
  Espace dispo  : 700 Mo

Libérez de la place puis relancez.

  Échap retour au menu
```

Chiffres formatés via `formatBytes` (`octets` / `Ko` / `Mo` / `Go`). Threshold = total input × 1.05 (5 % de marge pour les headers WAV).

### P-Saisie

```
Quel type d'enregistreur a produit ces fichiers ?

  ▸ Boîtier PaRec (Teensy) — fichiers déjà au bon format
    Autre détecteur — fichiers à ralentir 10× pour l'analyse

  Les détecteurs full-spectrum (AudioMoth, SM4, etc.) enregistrent
  à très haute fréquence — il faut les ralentir pour pouvoir les
  analyser. Le boîtier PaRec le fait déjà à l'enregistrement.

  Entrée valider   Échap retour
```

L'aide `dimColor` sous le sélecteur est volontairement **descriptive plutôt que technique** : « ralentir 10× » > « expansion temporelle ×10 », « très haute fréquence » > « 250 kHz full-spectrum ». Footer simplifié à 2 hints (1 seul champ — pas de Tab, pas de `←→`).

### P-Confirmation

**Variante mode `expand-10x` (Autre détecteur)** — la durée affichée est l'audio **post-ralentissement** (≈ 10× le temps d'enregistrement réel). On le rend explicite avec « une fois étendu » :

```
📁 /Users/.../Vigie-2026-pointA1

On va découper 12 enregistrements (environ 2 h 30 d'audio une fois étendu)
en morceaux de 5 secondes.

Type d'enregistreur choisi : Autre détecteur (ralentissement 10×)
Dossier de sortie :          ./processed/

Vos fichiers d'origine ne seront pas modifiés.

  Entrée découper   Échap modifier la saisie
```

**Variante mode `preserve` (Boîtier PaRec)** — pas de ralentissement, durée affichée = temps d'enregistrement = audio d'analyse. Pas de qualifier :

```
On va découper 12 enregistrements (environ 30 minutes d'audio)
en morceaux de 5 secondes.
```

**Wording-clé** :

- **« morceaux »** (jamais `chunks`). C'est de l'anglais, jargon, et la non-tech ne le reconnaît pas.
- **Durée en minutes/heures** plutôt qu'en compte de morceaux — c'est l'unité mentale qu'elle a.
- **« une fois étendu »** uniquement en `expand-10x`. Évite de faire croire à l'utilisatrice qu'elle a enregistré 2 h 30 alors qu'elle a enregistré 15 min de full-spectrum. Aligne avec le wording du sélecteur (« ralentir 10× pour l'analyse »).
- **Rappel non-destructif** en `dimColor`, parallèle au rappel du flow rename (« rien n'est perdu »).
- **« Autre détecteur (ralentissement 10×) »** : reprend le wording de l'option choisie pour confirmer le bon choix.

### P-Confirmation — pendant l'exécution

**Variante 1 — pendant le 1ᵉʳ fichier (ETA pas encore disponible)** :

```
📁 /Users/.../Vigie-2026-pointA1

Découpage en cours…

  Fichier 1 sur 100  •  20260507_210501T.WAV

  █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  2 %
  3 morceaux • Temps écoulé 5 s • Calcul du temps restant…

  Vos fichiers d'origine ne sont pas modifiés.
  Dossier de sortie : ./processed/
```

**Variante 2 — après ≥ 1 fichier complet (ETA visible)** :

```
📁 /Users/.../Vigie-2026-pointA1

Découpage en cours…

  Fichier 6 sur 100  •  20260507_212001T.WAV

  ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  12 %
  120 morceaux • Temps écoulé 1 min 30 s • Encore environ 5 min 40 s

  Vos fichiers d'origine ne sont pas modifiés.
  Dossier de sortie : ./processed/
```

Les 2 dernières lignes en `dimColor`. **Barre de 40 caractères** : `█` pour la partie remplie, `░` pour la partie vide. Pourcentage = `round((chunksWritten / totalChunksEstimate) × 100)` clamp à 100.

**Wordings calibrés** :

- `Calcul du temps restant…` (pas `Estimation en cours…`)
- `Encore environ X` (pas `Restant ≈ X` — `≈` est trop technique)
- `Temps écoulé X` (pas `Écoulé X` — elliptique)
- `N morceaux` (pas `N morceaux créés` — redondant, on voit qu'on crée)

**Format court de durée** (pour `Temps écoulé` et `Encore environ`) :

- `< 60 s` → `42 s`
- `< 1 h` → `1 min` ou `2 min 05 s`
- `≥ 1 h` → `1 h 30 min`

**Adaptive masking — petits batches** : si `filesTotal < 5`, la barre reste affichée mais la portion `• Encore environ X` (ou `• Calcul du temps restant…`) est **masquée** de la ligne stats. La ligne devient alors `N morceaux • Temps écoulé X`. Raison : sur un petit batch (< 25 s de run estimé), l'ETA n'apporte rien et la barre seule suffit.

**Refresh** : throttle UI à ~10 Hz (100 ms entre setStates sur `chunk-written`). `file-start` et `file-done` forcent un setState. Un `finalizeRender()` synchrone est appelé avant `onComplete()` pour garantir la barre à 100 % juste avant l'unmount (jamais dans un cleanup `useEffect` — risque de setState post-unmount).

Footer vide (cf. Footer raccourcis § Cas particuliers — pas afficher Ctrl+C pour éviter les abandons accidentels sur un run de 25 min).

### P-Résultat (variante A : tout OK)

```
✓ Terminé !

  12 enregistrements découpés
  720 morceaux créés dans ./processed/
  Temps écoulé : 12 minutes

  Vos fichiers d'origine sont intacts dans ce dossier.

  Entrée retour au menu
```

`Temps écoulé` est en `dimColor` (information secondaire). Le format suit `formatDuration` (cf. `src/lib/format/duration.ts`) : secondes sous 1 min, minutes sous 1 h, sinon `X h MM`.

Si applicable, ajouter en `dimColor` après le compte de morceaux :

```
  2 fichiers trop volumineux ignorés (> 500 Mo)
  1 fichier ignoré (déjà au format morceau)
```

### P-Résultat (variante B : interruption Ctrl+C)

```
ℹ Découpage arrêté à votre demande

  3 enregistrements découpés
  180 morceaux créés dans ./processed/
  Temps écoulé : 5 minutes

  Vous pouvez relancer chiro plus tard — il faudra d'abord renommer
  ou supprimer le dossier « processed » créé.

  Entrée retour au menu
```

L'invitation au re-run mentionne le dossier `processed/` partiel — l'utilisatrice doit savoir qu'il existe et qu'il faudra le déplacer/supprimer avant un nouveau run.

### P-Résultat (variante C : tout en échec)

`color="yellow"`. Rare en pratique (disque plein dès le 1ᵉʳ chunk, ou tous les fichiers non-PCM).

```
⚠ Aucun enregistrement n'a pu être découpé

  • format audio inhabituel — non géré pour l'instant (12 fichiers)

  Entrée retour au menu
```

Pas de phrase de réassurance — la situation est anormale, l'utilisatrice doit en parler à son conjoint dev.

### P-Résultat (variante D : erreurs partielles)

```
⚠ Découpage terminé avec 2 soucis

  10 enregistrements découpés
  600 morceaux créés dans ./processed/
  Temps écoulé : 12 minutes

  2 enregistrements n'ont pas pu être découpés :

    • format audio inhabituel — non géré pour l'instant (1 fichier)
        PaRec3_20260511_213045.wav
    • fichier illisible — peut-être corrompu pendant le transfert (1 fichier)
        PaRec3_20260511_220011.wav

  Les autres enregistrements ont bien été découpés.
  Vos fichiers d'origine sont intacts dans ce dossier.

  Entrée retour au menu
```

Groupage par message d'erreur (max 5 fichiers affichés par groupe, le reste résumé en `dimColor` `... et N autres`).

### Codes d'erreur Process → libellés FR

| Code interne                | Libellé FR                                                        |
| --------------------------- | ----------------------------------------------------------------- |
| `invalid-header`            | `fichier illisible — peut-être corrompu pendant le transfert`     |
| `unsupported-format`        | `format audio inhabituel — non géré pour l'instant`               |
| `unsupported-bit-depth`     | `résolution audio non supportée (16 ou 24 bits uniquement)`       |
| `no-samples`                | `fichier sans contenu audio`                                      |
| `ENOENT`                    | `le fichier a disparu pendant l'opération`                        |
| `EACCES`, `EPERM`           | `permission refusée par le système`                               |
| `write:ENOSPC`              | `plus de place sur le disque — libérez de l'espace puis relancez` |
| `write:EACCES`              | `permission refusée par le système`                               |
| `write:<autre>`             | `écriture impossible (code: <X>)`                                 |
| `mkdir:<X>`                 | `impossible de créer le sous-dossier « processed »`               |
| `skippedTooLarge` (compte)  | `fichier trop volumineux (> 500 Mo) — non géré pour l'instant`    |
| `skippedAlreadyChunked` (c) | (skip silencieux — pas affiché comme une erreur)                  |

## Choix UX validés (rappel)

- **Composant FormScreen maison** (pas `ink-form`, pas `<Form>` générique réutilisable) : un seul formulaire dans le MVP, ~50 lignes avec `useState<number>(focusedIndex)` + 4 `<TextInput>` empilés. Refactor en composant générique uniquement à la 3ᵉ utilisation (Règle de Trois). De même pour le sélecteur Teensy/Autre de la Phase 5 : inline dans `vigie-process/FormScreen.tsx`, pas extrait en `RadioSelect`.
- **Validation hybride** : silencieuse pendant la frappe (juste un indicateur dimColor de complétion), erreurs explicites au blur ou à la tentative de submit.
- **Pré-scan AVANT la saisie** (écran Constat) : économise 4 saisies si l'utilisatrice n'est pas dans le bon dossier.
- **3 exemples sur l'écran de Confirmation**, pas 1 — montre un pattern cohérent.
- **Confirmation explicite Entrée**, jamais une touche aléatoire pour déclencher l'action destructive.
- **« morceaux » jamais « chunks »**, **durée en minutes** jamais en compte de morceaux côté Confirm, **réassurance non-destructive** systématique sur Confirm + Result du flow découper.
- **Moteur de découpage silencieux** (Phase 6). Le pipeline interne (worker pool wavefile vs fast-path sox) est invisible dans la TUI : aucun footer "Moteur : sox", aucun hint "Astuce : installez sox". La cible naturaliste n'a pas le modèle mental ; nommer un moteur invite une question sans réponse utile. L'ETA absorbe naturellement les écarts via la moyenne glissante. L'incitation à installer sox vit **uniquement** dans le README (lu par le binôme dev au setup initial). Le pipeline réellement utilisé est loggé dans `~/.chiro/sessions.jsonl` (`engine: "wavefile" | "sox"`, `engine_fallback_count`) pour diagnostic dev.
- **`formatDuration` affiche la durée audio source**, pas le wall-clock estimé du traitement. Avec sox, le wall-clock devient bien inférieur à la durée audio — c'est attendu, la "durée annoncée" reste celle des enregistrements, jamais le temps de calcul.
