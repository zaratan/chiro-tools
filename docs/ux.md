# UX — Wordings et conventions visuelles

Ce document est la source de vérité pour **tous les libellés affichés** et les **conventions visuelles Ink**. Les valeurs ci-dessous sont prêtes à coller dans le code. Ne pas reformuler sans relecture du fichier `vision.md` (utilisatrice non-tech, ton bienveillant).

## Conventions visuelles globales

### Couleurs (toutes via les props `color` / `backgroundColor` d'Ink)

| Usage | Couleur Ink | Pourquoi |
|---|---|---|
| Succès, validation | `green` | Standard |
| Avertissement non-bloquant, skip, collision | `yellow` | Standard |
| Erreur, validation invalide | `red` | Standard |
| Valeur saisie par l'utilisatrice (mise en avant) | `cyan` | Non-anxiogène |
| Aide contextuelle, raccourcis footer | `dimColor` (prop booléenne) | Discret, **jamais `gray`** (invisible sur Solarized) |
| Chemins de fichiers, valeurs exemples | `cyan` ou texte brut | Lisible |

### Caractères Unicode (utilisés en début de ligne pour scanabilité)

- `✓` — succès
- `⚠` — avertissement
- `ℹ` — info neutre
- `📁` — dossier
- `→` — transition (avant → après)
- `•` — puce de liste (jamais `-` ou `*`)

**Pas d'autres emojis décoratifs** dans les libellés. On garde ces 6.

### Layout général

- **Bordure principale** : `borderStyle="round"` autour de la zone de contenu.
- **Largeur fixe** : `width={70}` sur la zone centrale. Stabilise le rendu quel que soit le terminal.
- **Footer raccourcis** : séparé par `borderTop`, sans bordures latérales. Couleur `dimColor`.
- **Espacement** : `marginY={1}` entre blocs principaux, `marginTop={1}` avant footer. Pas plus — l'écran tient en 80×24.
- **Pas de bordure** autour de chaque champ de formulaire (bruit visuel).

### Footer raccourcis

Chaque écran a son footer adapté. Format type :

```
  Tab champ suivant   Entrée valider   Échap retour
```

Couleur : `dimColor`. Séparateur : 3 espaces (pas de pipe `|`).

## Navigation clavier — référence

| Touche | Action | Affichée en footer ? |
|---|---|---|
| `Tab` / `Maj+Tab` | Champ suivant / précédent (FormScreen) | Oui sur FormScreen |
| `Entrée` | Valider l'écran courant | Toujours |
| `Échap` | Revenir à l'écran précédent (ou quitter depuis Menu) | Toujours sauf Résultat |
| `↑` / `↓` | Naviguer dans le menu | MenuScreen |
| `Ctrl+C` | Quitter immédiatement (ou stopper le batch en cours) | Implicite — jamais affiché |

## Wordings par écran — prêts à coller

### Écran 0 — Menu

```
chiro — outils Vigie-Chiro

Que voulez-vous faire ?

  ▸ Préfixer des enregistrements pour Vigie-Chiro
    Quitter

  ↑↓ choisir   Entrée valider   Échap quitter
```

Item sélectionné préfixé par `▸ ` (avec un espace). Items non sélectionnés alignés sur la même colonne (`  ` deux espaces).

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

**Footer** :
```
  Tab champ suivant   Entrée valider   Échap retour
```

### Écran 3 — Confirmation (nominal)

```
On va renommer 7 fichiers comme ceci :

  20260511_213045.wav  →  Car040962-2026-Pass3-A1-20260511_213045.wav
  20260511_220011.wav  →  Car040962-2026-Pass3-A1-20260511_220011.wav
  20260512_023322.wav  →  Car040962-2026-Pass3-A1-20260512_023322.wav

  ... et 4 autres fichiers du même genre

ℹ 1 fichier sera laissé tel quel (déjà au bon format) :
    Car040962-2026-Pass3-A1-old.wav

Le nom original est conservé en fin du nouveau nom — rien n'est perdu,
vous pouvez retrouver chaque fichier à partir de sa fin.

  Entrée renommer   Échap modifier la saisie
```

**Variantes** :

- Si N ≤ 3 : afficher les N exemples, supprimer la ligne `... et X autres`.
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

  7 fichiers renommés
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
⚠ Renommage terminé avec 1 souci

  6 fichiers renommés ✓
  1 fichier n'a pas pu être renommé :
    └ 20260511_213122.wav
      (un fichier portant le nom cible existe déjà — non remplacé)

Les autres fichiers ont bien été renommés.

  Entrée retour au menu
```

Codes d'erreur → libellés :

| Code | Libellé |
|---|---|
| `EEXIST` | `un fichier portant le nom cible existe déjà — non remplacé` |
| `EACCES` / `EPERM` | `permission refusée par le système` |
| `ENOENT` | `le fichier a disparu pendant l'opération` |
| autre | `erreur inattendue (code: XXX)` |

### Écran 4 — Résultat (variante D : interruption Ctrl+C)

```
⚠ Renommage interrompu

  3 fichiers déjà renommés ✓ (conservés)
  Reste 5 fichiers non traités.

Vous pouvez relancer chiro — les fichiers déjà renommés seront
automatiquement reconnus et non re-renommés.

  Entrée retour au menu
```

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

## Choix UX validés (rappel)

- **Composant FormScreen maison** (pas `ink-form`, pas `<Form>` générique réutilisable) : un seul formulaire dans le MVP, ~50 lignes avec `useState<number>(focusedIndex)` + 4 `<TextInput>` empilés. Refactor en composant générique uniquement à la 3ᵉ utilisation (Règle de Trois).
- **Validation hybride** : silencieuse pendant la frappe (juste un indicateur dimColor de complétion), erreurs explicites au blur ou à la tentative de submit.
- **Pré-scan AVANT la saisie** (écran Constat) : économise 4 saisies si l'utilisatrice n'est pas dans le bon dossier.
- **3 exemples sur l'écran de Confirmation**, pas 1 — montre un pattern cohérent.
- **Confirmation explicite Entrée**, jamais une touche aléatoire pour déclencher l'action destructive.
