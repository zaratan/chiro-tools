# chiro-tools

CLI interactive pour préparer des enregistrements `.wav` au format **Vigie-Chiro** (programme français de sciences participatives sur les chauves-souris).

L'outil ouvre une interface dans le terminal et guide l'utilisatrice à travers les étapes pour préfixer ses fichiers selon le format attendu par Vigie-Chiro, sans rien casser.

## Documentation

La spec complète du projet est dans [`docs/`](./docs/) :

- [`docs/README.md`](./docs/README.md) — index et ordre de lecture
- [`docs/vision.md`](./docs/vision.md) — utilisatrice cible, contexte
- [`docs/spec.md`](./docs/spec.md) — spec fonctionnelle
- [`docs/ux.md`](./docs/ux.md) — wordings et conventions visuelles
- [`docs/architecture.md`](./docs/architecture.md) — stack et build
- [`docs/roadmap.md`](./docs/roadmap.md) — phases d'implémentation

## État d'avancement

**Phase 0 (outillage) — ✓ validée.** Le projet a sa stack opérationnelle :

- Runtime : **Bun** (dev + build)
- TUI : **Ink 6** + **React 19**
- Tests : **vitest**
- Lint/format : **eslint** + **prettier**
- Hooks git : **husky** + **lint-staged**

La chaîne `bun build --compile` produit un binaire macOS arm64 fonctionnel (~62 MB, autonome).

## Développement

```bash
pnpm install          # installer les dépendances
pnpm dev              # lancer la TUI en mode dev
pnpm dev:watch        # lancer la TUI avec hot-reload (relance auto à chaque save)
pnpm test             # lancer les tests vitest
pnpm check            # lint + typecheck + format:check + test (à passer avant chaque commit)
pnpm build:darwin-arm64   # produire le binaire macOS arm64
```

L'installation et la distribution publique (signature, GitHub Releases, install.sh) sont prévues en Phase 4 — voir [`docs/roadmap.md`](./docs/roadmap.md).
