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
- **Sur les écrans d'erreur pendant l'exécution** (run-error, cf. Écran 3 et P-Confirmation dégradés), le footer affiche `Échap revenir au début` : Échap ramène à l'écran Constat, pas au menu — un simple « retour » serait ambigu sur ce qu'il désigne. Le run-error des flows zip ajoute `Entrée réessayer` devant (cf. A-Confirmation dégradé), **mais seulement quand le code d'erreur est transitoire** — leurs runs sont longs, et un réessai qui ne peut pas aboutir est pire que pas de réessai.
- **Sur l'écran de Confirmation pendant l'exécution du renommage**, le footer est vide (Ctrl+C reste fonctionnel mais on ne l'affiche pas pour éviter les abandons accidentels).

## Navigation clavier — référence

| Touche            | Action                                                                                                                                                                                                                                                     | Affichée en footer ?       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `Tab` / `Maj+Tab` | Champ suivant / précédent (FormScreen) — alias de `↓` / `↑`                                                                                                                                                                                                | Non (redondant avec `↑↓`)  |
| `↑` / `↓`         | Naviguer dans le menu, ou entre les champs du formulaire                                                                                                                                                                                                   | MenuScreen, FormScreen     |
| `←` / `→`         | Décrémenter / incrémenter un champ numérique (Année, Passage)                                                                                                                                                                                              | Oui sur FormScreen         |
| `Entrée`          | Valider l'écran courant (sur UpdateScreen : uniquement quand une version est dispo)                                                                                                                                                                        | Toujours                   |
| `Échap`           | Revenir à l'écran précédent (ou quitter depuis Menu)                                                                                                                                                                                                       | Toujours sauf Résultat     |
| `Ctrl+C`          | Quitter immédiatement (sauf : pendant un renommage/découpage en cours, où Ctrl+C est ignoré ; pendant une création de zip ou de série, où il **annule proprement** le run ; pendant un check de mise à jour, où il annule et revient au menu, comme Échap) | Implicite — jamais affiché |

## Wordings par écran — prêts à coller

### Écran 0 — Menu

```
chiro — outils Vigie-Chiro

Que voulez-vous faire ?

  ▸ Préfixer des enregistrements pour Vigie-Chiro
    Découper les enregistrements (pour Tadarida)
    Créer les zips à déposer sur Vigie-Chiro
    Sauvegarder les enregistrements découpés (un seul zip)
    Vérifier les mises à jour
    Quitter

  ↑↓ choisir   Entrée valider   Échap quitter
```

Item sélectionné préfixé par `▸ ` (avec un espace). Items non sélectionnés alignés sur la même colonne (`  ` deux espaces).

**Six entrées depuis la Phase 9.** Les deux flux zip sont deux entrées distinctes, pas un sélecteur : elles ne produisent pas la même chose et ne servent pas au même usage (déposer / garder). Le verbe **« Créer »** est repris pour le dépôt parce que `Préfixer` et `Préparer` partagent leurs quatre premières lettres — au scan, six initiales distinctes valent mieux qu'un mot plus juste.

**Variante — auto-check au boot a trouvé une nouvelle version** : entre la liste d'items et le footer, afficher en `color="yellow"` :

```
chiro — outils Vigie-Chiro

Que voulez-vous faire ?

  ▸ Préfixer des enregistrements pour Vigie-Chiro
    Découper les enregistrements (pour Tadarida)
    Créer les zips à déposer sur Vigie-Chiro
    Sauvegarder les enregistrements découpés (un seul zip)
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

### Écran 3 — Confirmation (dégradé : erreur pendant le renommage)

Rare : `applyRenames` peut rejeter en dehors du chemin normal (erreur non capturée par le per-file try/catch interne). Sans ce garde-fou, l'app crasherait avec une stack trace brute — exactement l'anxiété que ce mode dégradé évite.

```
📁 /Users/.../Vigie-2026-pointA1

⚠ Une erreur est survenue pendant le renommage.

Permission refusée par le système.

Détail technique : EACCES
  (à transmettre si vous demandez de l'aide)

  Échap revenir au début
```

Même structure que l'écran 1 « erreur inattendue au scan » : titre bienveillant, message clair issu de `mapErrorCodeToMessage` (affiché seulement si le code est reconnu — un code inconnu n'affiche que le détail technique, pas une devinette), code brut en cyan **au complet, jamais tronqué**, rappel `dimColor` en dessous. Pas de reprise possible sur cet écran — Échap ramène à l'écran Constat, l'utilisatrice relance depuis le début (d'où « revenir au début » plutôt qu'un « retour » ambigu).

### Écran 4 — Résultat (variante A : tout OK)

```
✓ Terminé !

  7 fichiers renommés avec le préfixe
      Car040962-2026-Pass3-A1-
  1 fichier laissé tel quel (déjà au bon format)

Vous pouvez maintenant les découper, puis créer les zips à déposer
sur Vigie-Chiro.

  Entrée retour au menu
```

La dernière ligne a été corrigée en 9.D : elle disait « Vous pouvez maintenant les téléverser sur Vigie-Chiro », ce qui était faux sur deux points — le verbe (« téléverser » viole la règle « déposer ») et le fait, puisque depuis les Phases 5 et 9 préfixer ne suffit plus : il faut découper puis empaqueter avant de déposer quoi que ce soit.

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

Header en `bold cyan` comme l'écran Menu. Pendant cet état, Ctrl+C annule la vérification et revient au menu — comme Échap — au lieu de quitter chiro immédiatement : le fetch est proprement aborté via l'`AbortController` local à l'écran. `runningRef` sert uniquement à empêcher le gestionnaire Ctrl+C **global** de l'App de couper court pendant que la promesse est en vol ; c'est `UpdateScreen` lui-même, via son propre `useInput`, qui intercepte Ctrl+C ici et déclenche l'annulation.

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

### Self-update — `install.sh`, vérification d'intégrité

`install.sh` s'exécute hors Ink (premier install via `curl | bash`, ou self-update après fermeture de la TUI) : simples `echo`, mêmes symboles `✓`/`⚠` que le reste de l'app pour rester dans le même registre malgré l'absence de composants Ink.

Succès (une ligne, juste avant l'extraction) :

```
✓ Fichier téléchargé vérifié
```

Avertissement non-bloquant — fichier de contrôle absent (releases publiées avant le Chantier D), aucun outil `sha256sum`/`shasum` sur la machine, ou fichier présent mais ne couvrant pas cet asset (release cassée) :

```
⚠ Impossible de vérifier que le téléchargement est complet
  (cette version ne fournit pas de fichier de contrôle).
  L'installation continue normalement.
```

→ stdout, l'installation se poursuit. Seul le texte entre parenthèses change selon la cause exacte — le reste ne bouge jamais : l'utilisatrice n'a rien à distinguer entre ces cas, ils se résolvent tous en « rien à faire, ça continue ».

Échec dur — la somme ne correspond pas (fichier corrompu ou tronqué) :

```
⚠ Le fichier téléchargé est incomplet ou abîmé.

Rien n'a été installé : votre version actuelle de chiro
n'a pas été touchée.

C'est presque toujours une coupure de connexion passagère.
Il suffit de recommencer l'installation (ou la mise à jour
depuis chiro) pour réessayer.

Détail technique : somme de contrôle SHA256 différente de
  celle attendue (à transmettre si vous demandez de l'aide)
```

→ stderr, quit code 1. Même structure que les écrans d'erreur Ink : titre bienveillant → rassurance (rien n'est cassé) → action (réessayer) → détail technique en dernier.

### Self-update — échec du script épinglé (fallback)

Depuis le Chantier D, le self-update embarqué télécharge `install.sh` depuis le tag de la version courante plutôt que `main` (cf. `architecture.md` § Contrat `install.sh`). Si l'installation échoue au global (tag introuvable, mismatch, coupure réseau…), `index.tsx` affiche en plus, après le message d'`install.sh` :

```
La mise à jour automatique n'a pas pu aboutir.
Vous pouvez réessayer plus tard, ou installer manuellement en copiant cette commande dans un terminal :

  curl -fL https://raw.githubusercontent.com/zaratan/chiro-tools/main/scripts/install.sh | bash
```

→ stderr, uniquement quand le code de sortie final est non-nul — toujours une action de secours concrète, même quand le message technique qui précède ne l'est pas pour une non-tech.

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

### P-Confirmation (chargement : estimation)

Avant que la durée et le nombre de fichiers estimés ne soient disponibles (le temps de `stat` chaque fichier — quasi instantané, mais un état transitoire existe) :

```
Estimation…
```

`Text dimColor`, pas de footer (l'écran est trop éphémère pour qu'une navigation ait du sens avant que l'estimation ne soit prête). Correspond à l'état `kind: "loading"` du `ConfirmScreen` du flow Découper.

### P-Confirmation

**Variante mode `expand-10x` (Autre détecteur)** — la durée affichée est l'audio **post-ralentissement** (≈ 10× le temps d'enregistrement réel). On le rend explicite avec « une fois étendu » :

```
📁 /Users/.../Vigie-2026-pointA1

On va découper 12 enregistrements (environ 2 h 30 d'audio une fois étendu)
en fichiers de 5 secondes.

Type d'enregistreur choisi : Autre détecteur (ralentissement 10×)
Dossier de sortie :          ./processed/

Vos fichiers d'origine ne seront pas modifiés.

  Entrée découper   Échap modifier la saisie
```

**Variante mode `preserve` (Boîtier PaRec)** — pas de ralentissement, durée affichée = temps d'enregistrement = audio d'analyse. Pas de qualifier :

```
On va découper 12 enregistrements (environ 30 minutes d'audio)
en fichiers de 5 secondes.
```

**Wording-clé** :

- **« enregistrements »** pour les fichiers qu'elle manipule, **« fichiers »** pour ceux que le découpage produit. Jamais `chunks` (anglais, jargon), et jamais « morceaux » : le mot évoque la musique alors qu'il s'agit d'enregistrements naturalistes.
- **Durée en minutes/heures** plutôt qu'en compte de fichiers — c'est l'unité mentale qu'elle a.
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
  3 fichiers • Temps écoulé 5 s • Calcul du temps restant…

  Vos fichiers d'origine ne sont pas modifiés.
  Dossier de sortie : ./processed/
```

**Variante 2 — après ≥ 1 fichier complet (ETA visible)** :

```
📁 /Users/.../Vigie-2026-pointA1

Découpage en cours…

  Fichier 6 sur 100  •  20260507_212001T.WAV

  ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  12 %
  120 fichiers • Temps écoulé 1 min 30 s • Encore environ 5 min 40 s

  Vos fichiers d'origine ne sont pas modifiés.
  Dossier de sortie : ./processed/
```

Les 2 dernières lignes en `dimColor`. **Barre de 40 caractères** : `█` pour la partie remplie, `░` pour la partie vide. Pourcentage = `round((chunksWritten / totalChunksEstimate) × 100)` clamp à 100.

**Wordings calibrés** :

- `Calcul du temps restant…` (pas `Estimation en cours…`)
- `Encore environ X` (pas `Restant ≈ X` — `≈` est trop technique)
- `Temps écoulé X` (pas `Écoulé X` — elliptique)
- `N fichiers` (pas `N fichiers créés` — redondant, on voit qu'on crée)

**Format court de durée** (pour `Temps écoulé` et `Encore environ`) :

- `< 60 s` → `42 s`
- `< 1 h` → `1 min` ou `2 min 05 s`
- `≥ 1 h` → `1 h 30 min`

**Adaptive masking — petits batches** : si `filesTotal < 5`, la barre reste affichée mais la portion `• Encore environ X` (ou `• Calcul du temps restant…`) est **masquée** de la ligne stats. La ligne devient alors `N fichiers • Temps écoulé X`. Raison : sur un petit batch (< 25 s de run estimé), l'ETA n'apporte rien et la barre seule suffit.

**Refresh** : throttle UI à ~10 Hz (100 ms entre setStates sur `chunk-written`). `file-start` et `file-done` forcent un setState. Un `finalizeRender()` synchrone est appelé avant `onComplete()` pour garantir la barre à 100 % juste avant l'unmount (jamais dans un cleanup `useEffect` — risque de setState post-unmount).

Footer vide (cf. Footer raccourcis § Cas particuliers — pas afficher Ctrl+C pour éviter les abandons accidentels sur un run de 25 min).

### P-Confirmation (dégradé : erreur pendant le découpage)

Rare : `processWavFiles` peut rejeter en dehors du chemin normal (erreur non capturée par le per-file try/catch interne). Sans ce garde-fou, l'app crasherait avec une stack trace brute — exactement l'anxiété que ce mode dégradé évite.

```
📁 /Users/.../Vigie-2026-pointA1

⚠ Une erreur est survenue pendant le découpage.

Plus de place sur le disque — libérez de l'espace puis relancez.

Détail technique : ENOSPC
  (à transmettre si vous demandez de l'aide)

  Échap revenir au début
```

Même structure que P-Constat § espace disque insuffisant : titre bienveillant, message clair issu de `mapProcessErrorCodeToMessage` (affiché seulement si le code est reconnu — un code inconnu n'affiche que le détail technique, pas une devinette), code brut en cyan **au complet, jamais tronqué**, rappel `dimColor` en dessous. Échap ramène à l'écran P-Constat (d'où « revenir au début » plutôt qu'un « retour » ambigu). Ctrl+C n'a pas de traitement spécifique sur cet écran (le run n'est plus « en cours » une fois `run-error` atteint) — Échap suffit.

### P-Résultat (variante A : tout OK)

```
✓ Terminé !

  12 enregistrements découpés
  720 fichiers créés dans ./processed/
  Temps écoulé : 12 minutes

  Vos fichiers d'origine sont intacts dans ce dossier.

  Entrée retour au menu
```

`Temps écoulé` est en `dimColor` (information secondaire). Le format suit `formatDuration` (cf. `src/format/duration.ts`) : secondes sous 1 min, minutes sous 1 h, sinon `X h MM`.

Si applicable, ajouter en `dimColor` après le compte de fichiers :

```
  2 fichiers trop volumineux ignorés (> 500 Mo)
  1 fichier ignoré (déjà découpé)
```

### P-Résultat (variante B : interruption Ctrl+C)

```
ℹ Découpage arrêté à votre demande

  3 enregistrements découpés
  180 fichiers créés dans ./processed/
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
  600 fichiers créés dans ./processed/
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

| Code interne                                                      | Libellé FR                                                                                                           |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `invalid-header`                                                  | `fichier illisible — peut-être corrompu pendant le transfert`                                                        |
| `unsupported-format`                                              | `format audio inhabituel — non géré pour l'instant`                                                                  |
| `unsupported-bit-depth`                                           | `résolution audio non supportée (16 ou 24 bits uniquement)`                                                          |
| `no-samples`                                                      | `fichier sans contenu audio`                                                                                         |
| `ENOENT`                                                          | `le fichier a disparu pendant l'opération`                                                                           |
| `EACCES`, `EPERM`                                                 | `permission refusée par le système`                                                                                  |
| `ENOSPC`                                                          | `plus de place sur le disque — libérez de l'espace puis relancez`                                                    |
| `EROFS`                                                           | `ce disque est protégé en écriture — copiez les fichiers ailleurs puis relancez`                                     |
| `EXDEV`                                                           | `impossible de déplacer le fichier d'un disque à un autre (carte SD, disque externe…)`                               |
| `sox-*` (`sox-exit:N`, `sox-no-output`), `non-aligned-data-size*` | `chiro n'a pas réussi à traiter cet enregistrement — réessayez, et si ça recommence transmettez le détail technique` |
| `worker-died`, `worker-spawn-failed`, `no-workers-available`      | `le découpage s'est interrompu de façon inattendue — réessayez, et si ça recommence transmettez le détail technique` |
| `mkdir:<X>`                                                       | `impossible de créer le sous-dossier « processed »`                                                                  |
| `skippedTooLarge` (compte)                                        | `fichier trop volumineux (> 500 Mo) — non géré pour l'instant`                                                       |
| `skippedAlreadyChunked` (c)                                       | (skip silencieux — pas affiché comme une erreur)                                                                     |

## Wordings — Flow « Sauvegarder les enregistrements découpés » (Phase 8)

Zippe le contenu de `processed/` vers `archived/{préfixe}_YYYYMMDD.zip` (ou `processed_YYYYMMDD.zip` en repli). Non-destructif : `processed/` n'est jamais touché. Depuis la Phase 9, ce zip est la **copie de sauvegarde**, pas l'objet du dépôt — le portail refuse le ZIP64 dans lequel il tombe sur des volumes réels. Tous les wordings qui invitaient au dépôt ont donc été corrigés (cf. A-Résultat).

### A-Constat (nominal)

```
📁 /Users/.../Vigie-2026-pointA1

✓ 720 enregistrements trouvés dans ./processed/
  Volume total : 1,4 Go

Ce sont bien les enregistrements à mettre dans le zip ?

  Entrée continuer   Échap retour au menu
```

### A-Constat (dégradé : pas de `processed/`)

Ton informatif, pas d'alerte : la situation est normale, juste prématurée. Deux causes couvertes — le découpage pas encore fait, **et** le mauvais dossier (cause au moins aussi fréquente).

```
📁 /Users/.../Documents

Aucun dossier « processed » trouvé dans ce dossier.

Le zip se crée à partir des enregistrements découpés. Lancez d'abord
« Découper les enregistrements », puis revenez ici.

Si le découpage est déjà fait, vous n'êtes sans doute pas dans le
bon dossier. Dans le Terminal, tapez `pwd` pour voir où vous êtes.

  Échap retour au menu
```

### A-Constat (dégradé : `processed/` sans enregistrement)

Jamais « le dossier est vide » : les `.tmp` et dot-entries sont exclus du zip mais visibles dans le Finder — annoncer « vide » contredirait ce qu'elle a sous les yeux.

```
📁 /Users/.../Vigie-2026-pointA1

Le dossier « processed » ne contient aucun enregistrement.

Le découpage s'est peut-être arrêté en route. Relancez « Découper
les enregistrements », puis revenez ici.

  Échap retour au menu
```

### A-Constat (dégradé : dossier non writable / espace insuffisant / erreur de scan)

Mêmes patterns que P-Constat. Deux spécificités :

- non writable → « L'outil ne peut pas créer le sous-dossier « archived » ici. »
- espace insuffisant → ajouter `Le zip est une copie de vos enregistrements : il peut occuper presque autant de place.` puis `Libérez de la place puis réessayez.` (le modèle mental « un zip compresse » ne prédit pas le besoin d'espace).

### A-Confirmation

```
📁 /Users/.../Vigie-2026-pointA1

On va rassembler 720 enregistrements dans un fichier zip.

Nom du fichier : Car340581-2026-Pass1-A1_20260814.zip
Emplacement :    ./archived/
Taille du zip :  au plus 1,4 Go — souvent moins, le zip compresse

La date de création est dans le nom du fichier.
Un zip existe déjà dans ./archived/ — celui-ci s'ajoutera à côté.
Vos enregistrements restent dans ./processed/.
Rien n'est déplacé ni supprimé.

  Entrée créer le zip   Échap revenir au début
```

Nom du fichier en `cyan`. Les quatre dernières lignes du bloc en `dimColor` ; celle du zip existant est **conditionnelle** à la présence, dans `archived/`, d'un zip au format de nommage de chiro (`processed_` ou un préfixe Vigie-Chiro, daté). Aucun écran « un zip existe déjà, que faire ? » : le nom daté distingue les zips, et proposer « remplacer » violerait le principe non-destructif.

La ligne sur la date a été corrigée en 9.D : elle annonçait « la date **et l'heure** » alors que le nom est passé à la granularité du **jour** en 9.A.

### A-Confirmation (pendant la création)

Footer **vide**. Barre pilotée par les octets lus en source (robuste malgré la compression variable).

```
📁 /Users/.../Vigie-2026-pointA1

Création du zip en cours…

  Enregistrement 42 sur 720

  ██████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  15 %
  Temps écoulé 12 s • Encore environ 3 min

Vos enregistrements ne sont pas modifiés.
Dossier de sortie : ./archived/
Vous pouvez laisser cette fenêtre ouverte, ça continue tout seul.
```

La ligne de stats reprend **mot pour mot** le format du flow Découper (`Temps écoulé X • Encore environ Y`, séparateur `•`) : les formes `~X` et `≈ X` sont rejetées comme trop notationnelles, et deux flows affichant la même information de deux façons différentes est une confusion à eux seuls. Les trois dernières lignes en `dimColor`. Le cadre entier (chemin, titre, compteurs, barre, stats, réassurance, footer vide) est le composant partagé `components/ProgressPanel.tsx` depuis la Phase 9.0 — les trois `RunningView` de l'app n'en fournissent que les chaînes.

### A-Confirmation (dégradé : erreur pendant la création)

La deuxième ligne est l'information que l'utilisatrice cherche en premier — elle est garantie vraie par construction (aucun zip partiel ne subsiste jamais).

```
📁 /Users/.../Vigie-2026-pointA1

⚠ Une erreur est survenue pendant la création du zip.

Aucun fichier zip n'a été créé — vos enregistrements sont intacts.

Plus de place sur le disque — libérez de l'espace puis relancez.

Détail technique : ENOSPC
  (à transmettre si vous demandez de l'aide)

  Entrée réessayer   Échap revenir au début
```

**`Entrée` ramène à A-Confirmation**, nom du zip re-résolu (le jour a pu tourner, une collision a pu disparaître). Le réessai n'est proposé que pour les codes **transitoires** (colonne dédiée dans la table plus bas) : leurs libellés se terminent tous par « réessayez » — une instruction sans moyen de l'exécuter est pire que pas d'instruction. Sur un run de 12 minutes qui échoue à la 11ᵉ, refaire tout le parcours depuis le menu serait une punition. Le run n'est **pas** relancé directement : on repasse par l'écran de confirmation, comme pour toute action longue. Quand le réessai est proposé, une ligne `dimColor` le dit franchement : `(la création du zip reprend depuis le début)`.

### A-Résultat (succès)

```
✓ Terminé !

  720 enregistrements rassemblés dans un fichier zip
  ./archived/Car340581-2026-Pass1-A1_20260814.zip
  Taille : 890 Mo
  Temps écoulé : 6 minutes

Ce fichier est votre copie de sauvegarde : gardez-le de côté.

ℹ Pour déposer sur Vigie-Chiro, choisissez
  « Créer les zips à déposer sur Vigie-Chiro » dans le menu.

📁 /Users/.../Vigie-2026-pointA1
Vos enregistrements sont toujours dans ./processed/.

  Entrée retour au menu
```

Chemin du zip affiché **relatif** (`./archived/…`), jamais absolu : un chemin utilisateur réel dépasse la largeur de 70 et serait coupé — d'où le `📁 cwd` en `dimColor` plus bas, sans lequel elle n'aurait aucun moyen de localiser le fichier. `Temps écoulé` et les deux dernières lignes en `dimColor`.

**Correction Phase 9** : la ligne « Vous pouvez maintenant déposer ce fichier sur Vigie-Chiro » était devenue fausse — c'est précisément le fichier que le portail refuse. Le libellé de l'entrée de menu est cité **exactement**, sinon elle cherche une ligne qui n'existe pas.

### A-Résultat (interruption Ctrl+C)

```
ℹ Création du zip arrêtée à votre demande

Aucun fichier zip n'a été créé.

Rien n'a été modifié : vos enregistrements sont intacts dans
./processed/. Vous pouvez recommencer quand vous voudrez.

  Entrée retour au menu
```

`ℹ` en `color="cyan"` (aligné sur le code existant de `vigie-process/ResultScreen.tsx`).

### Codes d'erreur Archive → libellés FR

Table commune aux **deux** flux zip (`src/screens/archive/errorMessages.ts`). Les codes système (`ENOSPC`, `EACCES`, `EPERM`, `EROFS`) sont mutualisés dans `src/screens/fsErrorMessages.ts` — un seul wording pour les quatre flows.

La colonne **Transitoire** est ce qui décide de l'affichage de `Entrée réessayer` (`isTransientArchiveError`) : proposer un réessai qui ne peut structurellement pas aboutir, à quelqu'un qui vient de perdre douze minutes, est la pire fuite de confiance possible. Tout code non listé comme définitif est traité comme transitoire — le défaut est celui qui laisse une action à faire.

| Code interne                 | Libellé FR                                                                                                                   | Transitoire ?          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `mkdir:<X>`                  | `impossible de créer le sous-dossier « archived »` (ou `« upload »` — le libellé de dossier est un paramètre, pas un mode)   | oui                    |
| `ENOENT`                     | `un enregistrement a changé ou disparu pendant la création du zip — réessayez`                                               | oui                    |
| `file-changed`               | `un enregistrement a changé ou disparu pendant la création du zip — réessayez`                                               | oui                    |
| `verify-failed`              | `chiro n'a pas pu vérifier que le zip était complet — il n'a pas été conservé, vos enregistrements sont intacts ; réessayez` | oui                    |
| `collision-exhausted`        | `trop de fichiers zip portent déjà ce nom — renommez ou rangez ceux du jour, puis réessayez`                                 | oui                    |
| `entry-too-large`            | `un enregistrement est trop volumineux pour être mis dans le zip — transmettez le détail technique`                          | **non** (déterministe) |
| `entry-too-large-for-volume` | `un enregistrement est trop volumineux pour être déposé sur Vigie-Chiro — transmettez le détail technique`                   | **non** (déterministe) |
| `zip64-required`             | `chiro n'a pas réussi à préparer des fichiers acceptés par Vigie-Chiro — transmettez le détail technique`                    | **non** (bug interne)  |

Les trois derniers codes n'appartiennent qu'au flux de dépôt en pratique. Leur libellé ne dit jamais « réessayez » et ne promet rien : il oriente vers le détail technique, c'est-à-dire vers son conjoint dev.

⚠ **Dette de wording** : le libellé de `collision-exhausted` parle encore de « la même minute » alors que les noms sont datés au **jour** depuis la Phase 9, et il dit « zips » là où la règle de vocabulaire ci-dessous impose « fichiers zip ». Remplacement à appliquer : `plusieurs fichiers zip portent déjà ce nom — renommez ou déplacez les précédents puis réessayez`.

## Wordings — Flow « Créer les zips à déposer » (Phase 9)

Rassemble `processed/` en une **série** de fichiers zip de 3,5 Go maximum dans `upload/{série}/`, chacun acceptable par le portail Vigie-Chiro (qui refuse le ZIP64). Mêmes écrans et mêmes composants que le flow sauvegarde ; ci-dessous, **uniquement ce qui diffère** — le reste (Constat dégradés, structure de l'écran d'erreur, footers) est identique.

### U-Constat (nominal)

```
📁 /Users/.../Vigie-2026-pointA1

✓ 720 enregistrements trouvés dans ./processed/
  Volume total : 1,4 Go

Ce sont bien les enregistrements à déposer sur Vigie-Chiro ?

  Entrée continuer   Échap retour au menu
```

Deux autres écarts sur les variantes dégradées : le dossier nommé est `« upload »` (« L'outil ne peut pas créer le sous-dossier « upload » ici. »), et le message d'espace disque passe au pluriel (« Les zips sont une copie de vos enregistrements : ils peuvent occuper presque autant de place. » — cf. dette de vocabulaire en fin de section).

### U-Confirmation (plusieurs fichiers attendus)

```
📁 /Users/.../Vigie-2026-pointA1

On va rassembler 720 enregistrements dans plusieurs fichiers zip.

Emplacement :      ./upload/Car340581-2026-Pass1-A1_20260814/
Taille de chacun : au plus 3,5 Go

Vigie-Chiro n'accepte pas les fichiers trop volumineux : vos
enregistrements seront répartis en plusieurs fichiers zip, à déposer
un par un sur le site.

Les fichiers zip n'apparaîtront qu'à la fin, tous en même temps.
Un dossier de dépôt existe déjà dans ./upload/ — celui-ci s'ajoutera à côté.
Vos enregistrements restent dans ./processed/.
Rien n'est déplacé ni supprimé.

  Entrée créer les zips   Échap revenir au début
```

- L'écran **ouvre par la phrase du patron maison** (« On va rassembler N enregistrements… »), qui porte toute la nouveauté à un mot près. Emplacement en `cyan`.
- Le bloc explicatif « Vigie-Chiro n'accepte pas… » est en **couleur par défaut, pas `dimColor`** : c'est le contrat de l'écran, pas de l'aide contextuelle.
- Les quatre dernières lignes en `dimColor`. Celle du dossier existant est **conditionnelle** à la présence d'un dossier de série dans `upload/`. Le nom affiché est celui **avant** résolution de collision : la collision se règle au commit (cf. `spec.md`), afficher un `-2` supposé serait une devinette.
- La ligne d'atomicité (« n'apparaîtront qu'à la fin ») est ici **et** dans l'écran de progression : c'est à T+6 min qu'elle ouvre le Finder pour vérifier, pas à T=0.

**Variante « un seul fichier attendu »** — déclenchée quand le volume source tient sous le plafond (estimation d'affichage seulement : la compression n'est connue qu'en cours de run, se tromper ne coûte qu'une phrase légèrement à côté, jamais un résultat faux) :

```
On va rassembler 720 enregistrements dans un fichier zip.

Emplacement :      ./upload/Car340581-2026-Pass1-A1_20260814/
Taille :           au plus 3,5 Go

Le fichier zip n'apparaîtra qu'à la fin.
…
  Entrée créer le zip   Échap revenir au début
```

Tout passe au singulier, la phrase « Vigie-Chiro n'accepte pas… » **disparaît** (sans objet), et le footer aussi.

### U-Confirmation (pendant la création)

Footer **vide**, comme partout ailleurs pendant un run long.

```
📁 /Users/.../Vigie-2026-pointA1

Création des fichiers zip en cours…

  Fichier zip 3
  Enregistrement 214 sur 720

  ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░  30 %
  Temps écoulé 4 min 20 s • Encore environ 9 min

Vos enregistrements ne sont pas modifiés.
Dossier de sortie : ./upload/
Les fichiers zip n'y apparaîtront qu'à la toute fin, tous ensemble.
Vous pouvez laisser cette fenêtre ouverte, ça continue tout seul.
```

- **`Fichier zip 3` n'a pas de total** : le nombre de volumes est inconnu tant que le run n'est pas fini (cf. `spec.md`). La ligne est **entièrement masquée tant qu'on est sur le premier volume** — un « Fichier zip 1 » qui ne bougerait jamais sur un run mono-volume (le cas d'un point d'écoute isolé, fréquent) serait absurde, et compter honnêtement à partir du deuxième ne coûte rien.
- **`Enregistrement 214 sur 720` est global**, jamais relatif au volume courant : elle suit une seule progression, pas N progressions imbriquées.
- Le dossier annoncé est `./upload/`, pas le dossier daté — celui-ci n'existe pas encore.

### U-Confirmation (annulation en cours)

Écran intermédiaire après Ctrl+C, avant le résultat. Supprimer un staging de 10 Go sur un disque externe prend 10 à 60 s : sans cet écran, la progression resterait figée avec Ctrl+C apparemment inopérant — indiscernable d'un plantage.

```
Annulation en cours…

Nettoyage des fichiers temporaires, un instant.
```

Seconde ligne en `dimColor`, footer vide, aucune touche active (l'annulation est déjà en cours, il n'y a rien à décider).

### U-Confirmation (dégradé : erreur pendant la création)

```
📁 /Users/.../Vigie-2026-pointA1

⚠ Une erreur est survenue pendant la préparation des zips.

Aucun fichier zip n'a été créé — vos enregistrements sont intacts.

Plus de place sur le disque — libérez de l'espace puis relancez.

Détail technique : ENOSPC
  (à transmettre si vous demandez de l'aide)
  (la création des zips reprend depuis le début)

  Entrée réessayer   Échap revenir au début
```

La ligne `(la création des zips reprend depuis le début)` et `Entrée réessayer` n'apparaissent **que pour les codes transitoires** (cf. table des codes, colonne dédiée). Sur un code définitif (`zip64-required`, `entry-too-large-for-volume`), il ne reste que `Échap revenir au début`.

### U-Résultat (succès, plusieurs fichiers)

```
✓ Terminé !

  720 enregistrements répartis dans 3 fichiers zip
  ./upload/Car340581-2026-Pass1-A1_20260814/
  Taille totale : 5,4 Go
  Temps écoulé : 18 minutes

Déposez les 3 fichiers sur Vigie-Chiro, un par un.
L'ordre n'a pas d'importance.

ℹ Vous pouvez aussi garder une copie complète de côté :
  choisissez « Sauvegarder les enregistrements découpés ».

📁 /Users/.../Vigie-2026-pointA1
Vos enregistrements sont toujours dans ./processed/.

  Entrée retour au menu
```

- Le dossier affiché est celui **réellement obtenu** (il peut porter un `-2`), jamais le nom prévu à l'aperçu.
- **Les noms de fichiers ne sont pas listés** : coût en O(N) sur un écran à hauteur fixe, et c'est dans le Finder qu'ils lui servent, où `_part2` se lit tout seul.
- L'incitation à la sauvegarde donne le **motif d'abord** (« garder une copie complète de côté ») et le geste ensuite. Ni `dimColor` (invisible = inutile) ni `⚠` (rien ne va mal). Le libellé de l'entrée de menu est cité exactement.
- `📁 cwd` en `dimColor` : le chemin du dossier est relatif, sans le cwd elle ne peut pas le retrouver dans le Finder.

**Variante N = 1** : `720 enregistrements rassemblés dans un fichier zip`, puis `Déposez ce fichier sur Vigie-Chiro.` — sans « un par un » ni « L'ordre n'a pas d'importance ».

### U-Résultat (interruption Ctrl+C)

```
ℹ Préparation du dépôt arrêtée à votre demande

Aucun fichier zip n'a été créé.

Rien n'a été modifié : vos enregistrements sont intacts dans
./processed/. Vous pouvez recommencer quand vous voudrez.

  Entrée retour au menu
```

`ℹ` en `color="cyan"`, comme les autres écrans d'interruption.

### Règles de vocabulaire figées en 9.D

Trois règles, à appliquer à **toute** l'app (pas seulement aux flux zip) :

1. **« déposer » est le verbe unique.** L'app disait indifféremment téléverser, déposer, envoyer. C'est le mot du portail Vigie-Chiro, celui qu'elle lira sur le site : tout autre synonyme l'oblige à traduire. Bannis : « téléverser », « uploader », « envoyer », « transmettre » (sauf dans « à transmettre si vous demandez de l'aide », qui parle du support, pas du portail).
2. **« fichiers zip », jamais « zips »** dans une phrase adressée à l'utilisatrice. « zips » est un raccourci de dev ; « fichier zip » est ce qu'elle voit dans le Finder. Exception assumée : le **libellé de menu** (« Créer les zips à déposer sur Vigie-Chiro ») et le hint de footer (« créer les zips »), où la contrainte de longueur prime et où le mot est isolé, pas noyé dans une phrase.
3. **Les compteurs sont globaux, jamais par volume.** `Enregistrement 214 sur 720` compte sur toute la série. Un compteur qui repartirait à 1 à chaque fichier zip donnerait l'impression que le travail recommence.

Les quatre écarts relevés dans le code au moment de figer ces règles **ont tous été corrigés en 9.D** : le « téléverser » de l'Écran 4 (qui était en plus devenu factuellement faux), « Les zips sont une copie… » du constat d'espace disque, « plusieurs zips… dans la même minute » de `collision-exhausted` (la minute n'a plus de sens depuis que le nom est daté au jour), et « la date **et l'heure** de création » de A-Confirmation. Il ne reste que les deux exceptions assumées ci-dessus, où « zips » est isolé et contraint par la longueur : le libellé de menu et le hint de footer.

## Choix UX validés (rappel)

- **Composant FormScreen maison** (pas `ink-form`, pas `<Form>` générique réutilisable) : un seul formulaire dans le MVP, ~50 lignes avec `useState<number>(focusedIndex)` + 4 `<TextInput>` empilés. Refactor en composant générique uniquement à la 3ᵉ utilisation (Règle de Trois). De même pour le sélecteur Teensy/Autre de la Phase 5 : inline dans `vigie-process/FormScreen.tsx`, pas extrait en `RadioSelect`.
- **Validation hybride** : silencieuse pendant la frappe (juste un indicateur dimColor de complétion), erreurs explicites au blur ou à la tentative de submit.
- **Pré-scan AVANT la saisie** (écran Constat) : économise 4 saisies si l'utilisatrice n'est pas dans le bon dossier.
- **3 exemples sur l'écran de Confirmation**, pas 1 — montre un pattern cohérent.
- **Confirmation explicite Entrée**, jamais une touche aléatoire pour déclencher l'action destructive.
- **« enregistrements » jamais « morceaux » ni « chunks »** (cf. Wording-clé P-Confirmation), **durée en minutes** jamais en compte de fichiers côté Confirm, **réassurance non-destructive** systématique sur Confirm + Result du flow découper. Depuis la Phase 9 s'ajoutent trois règles figées : **« déposer »** verbe unique, **« fichiers zip »** jamais « zips », **compteurs globaux** jamais par volume (cf. § « Règles de vocabulaire figées en 9.D »).
- **Deux entrées de menu pour les deux flux zip**, jamais un sélecteur ni une question « pour quoi faire ? » : les deux sorties coexistent, servent à deux choses différentes, et le choix se fait à l'entrée du flux, pas à l'intérieur.
- **Moteur de découpage silencieux** (Phase 6). Le pipeline interne (worker pool wavefile vs fast-path sox) est invisible dans la TUI : aucun footer "Moteur : sox", aucun hint "Astuce : installez sox". La cible naturaliste n'a pas le modèle mental ; nommer un moteur invite une question sans réponse utile. L'ETA absorbe naturellement les écarts via la moyenne glissante. L'incitation à installer sox vit **uniquement** dans le README (lu par le binôme dev au setup initial). Le pipeline réellement utilisé est loggé dans `~/.chiro/sessions.jsonl` (`engine: "wavefile" | "sox"`, `engine_fallback_count`) pour diagnostic dev.
- **`formatDuration` affiche la durée audio source**, pas le wall-clock estimé du traitement. Avec sox, le wall-clock devient bien inférieur à la durée audio — c'est attendu, la "durée annoncée" reste celle des enregistrements, jamais le temps de calcul.
