# chiro-tools

CLI interactive pour préparer des enregistrements `.wav` au format **Vigie-Chiro** (programme français de sciences participatives sur les chauves-souris).

L'outil ouvre une interface dans le terminal et guide l'utilisatrice à travers les étapes pour préfixer ses fichiers selon le format attendu par Vigie-Chiro, sans rien casser.

## Installation

```bash
curl -fL https://raw.githubusercontent.com/zaratan/chiro-tools/main/scripts/install.sh | bash
```

Cette commande télécharge le binaire adapté à votre système (macOS Apple Silicon ou Linux x86_64) et l'installe dans `~/.local/bin/chiro`. Si ce dossier n'est pas déjà dans votre `PATH`, le script affiche la ligne à ajouter dans `~/.zshrc` ou `~/.bashrc`.

Lancez ensuite `chiro` dans n'importe quel dossier contenant des enregistrements `.wav`.

**Plateformes supportées** : macOS arm64 (Apple Silicon), Linux x64.

### Alternative (lire le script avant exécution)

Si vous préférez auditer le script avant de l'exécuter :

```bash
curl -fL https://raw.githubusercontent.com/zaratan/chiro-tools/main/scripts/install.sh -o install.sh
less install.sh
bash install.sh
```

### Pinner une version

```bash
CHIRO_VERSION=v0.1.0 bash <(curl -fL https://raw.githubusercontent.com/zaratan/chiro-tools/main/scripts/install.sh)
```

## Pour aller plus vite (optionnel)

Le découpage peut prendre du temps sur une grosse session (par ex. une nuit complète d'AudioMoth). Pour accélérer fortement cette étape, vous pouvez installer **sox** :

- macOS : `brew install sox`
- Linux : `sudo apt install sox`

Chiro-tools le détecte automatiquement au lancement suivant.

Ordre de grandeur : une session qui prend 3 heures sans sox prend environ 10 minutes avec.

Ce n'est pas obligatoire — sans sox, le découpage fonctionne quand même, c'est juste plus long.

## Archiver une sauvegarde en ligne (optionnel)

chiro sait envoyer votre fichier de sauvegarde (`archived/*.zip`, produit par « Sauvegarder les enregistrements découpés ») vers un stockage en ligne bon marché, Scaleway Glacier. C'est utile le jour où le disque qui contient vos fichiers tombe en panne. Fonction **optionnelle** : sans elle, chiro marche exactement pareil.

Quatre étapes à faire une seule fois, sur l'ordinateur qui fait tourner chiro :

**1. Installer rclone** (l'outil qui transporte le fichier) :

- macOS : `brew install rclone`
- Linux : `sudo apt install rclone`

**2. Configurer le compte Scaleway** :

```bash
rclone config
```

Choisissez un nouveau remote, type de stockage **Scaleway**, puis collez la clé d'accès et la clé secrète. Elles se génèrent dans la console Scaleway, section **Identifiants API** (« IAM » → « Clés API »). Retenez le **nom du remote** que vous donnez à cette étape, il sert au réglage suivant.

**3. Créer `~/.chiro/settings.json`** avec le remote, le bucket Scaleway et le préfixe où ranger les fichiers :

```json
{
  "coffre": {
    "remote": "chiro-coffre",
    "bucket": "mon-bucket-scaleway",
    "prefix": "vigie-chiro"
  }
}
```

`remote` est le nom donné à l'étape 2 (jamais `remote:bucket`, juste le nom). chiro ne lit jamais vos identifiants, ils restent dans la configuration de rclone (`~/.config/rclone/rclone.conf`).

**4. Poser la règle de cycle de vie sur le bucket**, dans la console Scaleway (Object Storage → votre bucket → Règles de cycle de vie) : **« Abandonner les transferts multiparts incomplets »** (`AbortIncompleteMultipartUpload`) après **7 jours**. Sans cette règle, un envoi coupé par une panne de courant ou de réseau laisse des fragments **facturés** dans le bucket que rien ne vient jamais nettoyer. Ni chiro, ni vous.

Une fois ces réglages en place **et** rclone détecté, l'entrée « Archiver la sauvegarde en ligne » apparaît dans le menu de chiro. Tant que l'un des deux manque, elle reste invisible. C'est voulu : chiro ne signale jamais une fonction à moitié configurée.

## Récupérer une archive

Une fois en ligne, un fichier passe en classe **Glacier** : il n'est plus consultable directement, il faut d'abord demander sa **restauration**, qui prend **24 à 48 heures**, puis le rapatrier. chiro ne le propose pas depuis son interface : c'est un geste technique, à faire une fois tous les quelques années, par la personne qui a installé chiro.

```bash
# 1. Demander la restauration (remote / bucket / prefixe = ceux de ~/.chiro/settings.json)
rclone backend restore <remote>:<bucket>/<prefix>/<nom-du-zip> -o lifetime=7

# 2. Vérifier l'état (à refaire 24 à 48 heures plus tard)
rclone backend restore-status <remote>:<bucket>/<prefix>/<nom-du-zip>

# 3. Une fois restauré, rapatrier le fichier
rclone copy <remote>:<bucket>/<prefix>/<nom-du-zip> .
```

Coût : environ 0,009 €/Go restauré (une sauvegarde de 15 Go coûte environ 0,14 € à récupérer). `lifetime=7` garde le fichier consultable 7 jours avant qu'il ne reparte automatiquement en Glacier.

## Documentation

La spec complète du projet est dans [`docs/`](./docs/) :

- [`docs/README.md`](./docs/README.md) — index et ordre de lecture
- [`docs/vision.md`](./docs/vision.md) — utilisatrice cible, contexte
- [`docs/spec.md`](./docs/spec.md) — spec fonctionnelle
- [`docs/ux.md`](./docs/ux.md) — wordings et conventions visuelles
- [`docs/architecture.md`](./docs/architecture.md) — stack et build
- [`docs/roadmap.md`](./docs/roadmap.md) — phases d'implémentation

## Développement

```bash
pnpm install          # installer les dépendances
pnpm dev              # lancer la TUI en mode dev
pnpm dev:watch        # lancer la TUI avec hot-reload (relance auto à chaque save)
pnpm test             # lancer les tests vitest
pnpm check            # lint + typecheck + format:check + test (à passer avant chaque commit)
pnpm build:darwin-arm64   # produire le binaire macOS arm64
pnpm build:linux-x64      # produire le binaire Linux x64 (cross-compile depuis macOS)
pnpm build                # produit les 2 binaires
```

### Release

Pousser un tag matchant `vX.Y.Z` ou `vX.Y.Z-suffix` déclenche le workflow GitHub Actions (`.github/workflows/release.yml`) qui builde les 2 binaires sur runners natifs (`macos-latest` + `ubuntu-latest`) et publie une GitHub Release avec les assets.

```bash
git tag v0.1.0
git push origin v0.1.0
```

L'utilisatrice cible ne touche jamais aux tags — elle utilise simplement la commande `curl ... | bash` ci-dessus.
