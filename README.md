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
