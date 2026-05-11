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

## Wizard "Préfixer pour Vigie-Chiro" — 4 écrans

```
[Menu] → [Constat] → [Saisie] → [Confirmation] → [Résultat] → (retour Menu)
```

### Écran 0 — Menu principal

- Titre : `chiro — outils Vigie-Chiro`
- Sous-titre : `Que voulez-vous faire ?`
- Items (un seul au MVP, mais structure extensible) :
  - `Préfixer des enregistrements pour Vigie-Chiro` (item sélectionné par défaut)
  - `Quitter`
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

| # | Champ | Validation | Pré-rempli ? |
|---|---|---|---|
| 1 | Code du carré | `/^\d{6}$/` | Non |
| 2 | Année | `/^\d{4}$/` ET 1900 ≤ valeur ≤ 2100 | Oui — `new Date().getFullYear()` |
| 3 | Numéro de passage | entier ≥ 1 | Oui — `1` |
| 4 | Code du point | `/^[A-Za-z]\d$/` — normalisé en majuscule à la sortie | Non |

Comportement :

- **Navigation** : `Tab` / `Maj+Tab` entre champs ; `Entrée` = valider le formulaire entier (si tous valides) ou passer au champ suivant (équivalent Tab) ; `Échap` = retour au Constat.
- **Validation hybride** :
  - **Pendant la frappe** : pas d'erreur rouge. Affiche en `dimColor` un indicateur de complétion : `3/6 chiffres` pour le carré, etc. (pas obligatoire sur tous les champs, choisir au cas par cas).
  - **À la sortie du champ** (Tab ou tentative de submit) : si invalide, afficher l'erreur en rouge sous le champ. Si l'utilisatrice retourne dans le champ et modifie, l'erreur reste affichée mais redevient verte/disparaît si la valeur devient valide.
- **Soumission** : le formulaire ne peut être soumis que si les 4 champs sont valides. Si l'utilisatrice tape Entrée sur un formulaire incomplet, on focus le 1er champ invalide et on affiche son erreur.
- **Footer** : `Tab champ suivant   Entrée valider   Échap retour`

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

## Logging local

Chaque session écrit un événement JSONL en `append` dans `~/.chiro/last-run.log` (créer le dossier au boot s'il n'existe pas).

Format d'un événement :

```json
{
  "ts": "2026-05-11T21:30:45.123Z",
  "version": "0.1.0",
  "cwd": "/Users/.../Vigie-2026-A1",
  "action": "vigie-prefix",
  "input": { "carre": "040962", "annee": 2026, "passage": 3, "point": "A1" },
  "result": {
    "renamed": 7,
    "skipped_already_prefixed": 1,
    "skipped_collision": 0,
    "errored": [{ "file": "...", "reason": "EACCES" }],
    "interrupted": false
  }
}
```

Le log est **append-only** (jamais tronqué). À surveiller dans le futur : rotation si dépassement de taille — pas dans le MVP.

## Versioning

- `chiro --version` lit la version dans `package.json` (bundled au moment du `bun build --compile`).
- La version est aussi loggée dans chaque entrée du log local.
- Schéma : SemVer (`0.1.0` au MVP).

## Cas dégradés — checklist exhaustive

| Cas | Comportement attendu | Écran |
|---|---|---|
| Pas de TTY | Message stderr + quit code 1 | Avant Ink |
| `--version` | Affiche version + quit code 0 | Avant Ink |
| `--help` | Affiche help + quit code 0 | Avant Ink |
| Dossier vide | "Aucun fichier .wav trouvé" + chemin affiché | Constat |
| Aucun `.wav` (mais d'autres fichiers) | Idem | Constat |
| Tous les `.wav` déjà préfixés | Constat passe normalement → Saisie → Confirmation affiche 0 renommage prévu → l'utilisatrice peut quand même valider → Résultat variante B | Tous les écrans |
| Dossier non lisible (`R_OK` KO) | Message + quit | Constat |
| Dossier non writable (`W_OK` KO) | Message + bouton retour | Constat |
| `.WAV` majuscule | Normalisé en `.wav` dans le nom cible | Renommage |
| Collision avec fichier existant | Affichage Confirmation + skip Renommage | Confirmation + Résultat |
| `EXDEV` cross-device | Fallback `copyFile + unlink` transparent | Renommage |
| `EACCES` / `EPERM` sur un fichier | Consigner, continuer | Renommage |
| `ENOENT` (fichier supprimé entre scan et rename) | Consigner, continuer | Renommage |
| Caractères exotiques (accents, espaces, emojis) dans noms | Aucun traitement spécial, Node gère | Toujours |
| Symlinks dans le dossier | Ignorés au scan | Constat |
| Ctrl+C pendant la saisie | Quit immédiat code 130 | Toutes |
| Ctrl+C pendant le renommage | Stop propre, Résultat variante D | Renommage → Résultat |
| Terminal redimensionné en cours | Ink gère ; aucun traitement spécial requis | Toutes |
