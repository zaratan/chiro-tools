# chiro-tools

`chiro` prépare vos enregistrements `.wav` de chauves-souris pour **Vigie-Chiro**, le programme de sciences participatives du Muséum national d'Histoire naturelle.

Vous rentrez du terrain avec une carte SD pleine. `chiro` s'occupe de tout ce qui sépare ces fichiers du dépôt sur le portail : les renommer, les découper au format attendu, préparer les fichiers zip à déposer, et garder une copie de sauvegarde.

C'est une application qui s'utilise dans le Terminal, mais **il n'y a rien à taper d'autre que `chiro`** : tout se fait ensuite au clavier, dans un menu.

## Ce que fait chiro

Les cinq entrées du menu, dans leur ordre d'utilisation :

| Entrée du menu                                    | Ce que ça fait                                                                                              | En détail                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **Préfixer des enregistrements pour Vigie-Chiro** | Renomme vos `.wav` au format attendu, en gardant le nom d'origine                                           | [doc](docs/features/prefixer.md)          |
| **Découper les enregistrements (pour Tadarida)**  | Découpe en fichiers de 5 s réelles avec les métadonnées attendues — remplace Kaleidoscope                   | [doc](docs/features/decouper.md)          |
| **Créer les zips à déposer sur Vigie-Chiro**      | Prépare une série de fichiers acceptés par le portail                                                       | [doc](docs/features/deposer.md)           |
| **Sauvegarder les enregistrements découpés**      | Réunit tout dans un fichier zip unique, pour le conserver                                                   | [doc](docs/features/sauvegarder.md)       |
| **Archiver la sauvegarde en ligne**               | Envoie cette sauvegarde sur un stockage en ligne — optionnel, absent du menu tant qu'il n'est pas configuré | [doc](docs/features/archiver-en-ligne.md) |

Chaque doc dit aussi ce que la fonction **ne fait pas** et ce qui n'a pas été vérifié. C'est volontaire : vos enregistrements ne sont pas remplaçables, vous devez savoir sur quoi vous comptez.

Sur une session type, on enchaîne les trois premières, puis on sauvegarde une fois le dépôt terminé.

### Concrètement

```
PaRec12_20250919_200134.wav
→ Car340581-2026-Pass1-A1-PaRec12_20250919_200134.wav       (préfixer)
→ processed/Car340581-2026-Pass1-A1-PaRec12_..._000.wav      (découper)
→ upload/Car340581-2026-Pass1-A1_20260902/..._part1.zip       (déposer)
```

**Rien n'est jamais supprimé.** Le découpage, les fichiers zip et la sauvegarde écrivent tous à côté de vos fichiers, sans y toucher.

## Installation

```bash
curl -fL https://raw.githubusercontent.com/zaratan/chiro-tools/main/scripts/install.sh | bash
```

La commande télécharge le programme adapté à votre ordinateur et l'installe dans `~/.local/bin/chiro`. Si ce dossier n'est pas déjà connu de votre Terminal, le script affiche la ligne à ajouter dans `~/.zshrc` ou `~/.bashrc`.

**Ordinateurs supportés** : macOS Apple Silicon (M1 et suivants), Linux 64 bits.

Si vous préférez lire le script avant de l'exécuter :

```bash
curl -fL https://raw.githubusercontent.com/zaratan/chiro-tools/main/scripts/install.sh -o install.sh
less install.sh
bash install.sh
```

Pour installer une version précise :

```bash
CHIRO_VERSION=v0.1.0 bash <(curl -fL https://raw.githubusercontent.com/zaratan/chiro-tools/main/scripts/install.sh)
```

## Utilisation

Placez-vous dans le dossier qui contient les enregistrements d'une nuit, puis lancez `chiro` :

```bash
cd /chemin/vers/ma-nuit
chiro
```

Le menu s'ouvre. Déplacez-vous avec ↑ ↓, validez avec `Entrée`, quittez avec `Échap`.

`chiro` travaille toujours dans le dossier depuis lequel vous l'avez lancé, et vous affiche ce chemin à chaque écran. Il vous montre ce qu'il va faire **avant** de le faire, et attend `Entrée`.

**Un dossier = un passage** : une pose d’enregistreur sur un point d’écoute, le plus souvent une nuit. C’est l’organisation prévue. Pour trouver vos enregistrements, `chiro` ne descend pas dans les sous-dossiers. Seule exception : un sous-dossier `Brut` ou `Bruts`, lu sur un seul niveau. Ses fichiers y sont renommés sur place et `processed/` reste à la racine. Un même nom présent aux deux endroits est refusé.

## Aller plus vite (optionnel)

Le découpage peut être long sur une grosse session. L'outil **sox** l'accélère nettement :

- macOS : `brew install sox`
- Linux : `sudo apt install sox`

`chiro` le détecte tout seul au lancement suivant. Sans lui, le découpage fonctionne quand même, c'est juste plus long. Détails et chiffres dans la [doc du découpage](docs/features/decouper.md#vitesse).

## Mises à jour

`chiro` vous signale discrètement quand une nouvelle version existe. L'entrée « Vérifier les mises à jour » du menu s'occupe de l'installation.

## En cas de souci

Chaque session laisse une trace dans `~/.chiro/sessions.jsonl`. C'est le fichier à joindre si vous demandez de l'aide, avec le message d'erreur affiché en bas de l'écran.

Les [docs par fonction](docs/features/) listent les limites connues et ce qu'il faut faire quand ça se passe mal.

## Aller plus loin

- [`docs/`](docs/) — la conception du projet : vision, spec fonctionnelle, wordings, architecture, roadmap
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — développer, tester, publier une version
