# Contribuer à chiro-tools

Ce document s'adresse à qui touche au code. Pour l'usage de l'outil, voir le [README](./README.md) et les [docs par fonction](./docs/features/).

## Prérequis

- **Bun** (runtime et compilateur de binaires)
- **Node 22.13+** — requis par pnpm 11, qui utilise `node:sqlite`
- **pnpm 11**
- **git-lfs** — `test-data/` contient de vrais enregistrements Teensy et AudioMoth
- **sox** (optionnel) — active le chemin rapide du découpage et sa couverture de test
- **bsdtar** sur Linux (`sudo apt install libarchive-tools`) — les tests d'archive valident chaque fichier zip contre trois extracteurs indépendants et **échouent durement** si l'un manque

## Commandes

```bash
pnpm install          # installer les dépendances
pnpm dev              # lancer la TUI dans le dossier courant
pnpm dev:watch        # idem avec rechargement à chaque sauvegarde
pnpm test             # tests vitest
pnpm test:coverage    # idem + rapport de couverture
pnpm check            # lint + typecheck + format + test
pnpm build            # produire les deux binaires (macOS arm64 + Linux x64)
```

**`pnpm check` doit être vert avant tout commit.** Sans exception. Le hook pre-commit ne lance que `lint-staged` et `typecheck` — il est volontairement rapide et ne remplace pas `pnpm check`, qui reste à votre charge.

Pour essayer la TUI sur un jeu de données connu :

```bash
scripts/reset-demo.sh
cd /tmp/chiro-demo && bun /chemin/vers/chiro-tools/src/index.tsx
```

## Ce qu'il faut lire avant de coder

Dans cet ordre :

1. [`CLAUDE.md`](./CLAUDE.md) — les règles dures et les pièges connus. **C'est le document le plus important** : il liste les erreurs déjà commises et pourquoi les corriger a coûté cher.
2. [`docs/architecture.md`](./docs/architecture.md) — la structure du code et les décisions d'architecture, avec leurs motifs.
3. [`docs/ux.md`](./docs/ux.md) — **à relire avant de changer le moindre libellé**. Les wordings sont calibrés pour une utilisatrice non-technique ; ils ne se reformulent pas à la volée.
4. [`docs/roadmap.md`](./docs/roadmap.md) — ce qui est fait, ce qui vient, et ce qui a été écarté (avec le motif, pour ne pas re-litiger).

## Règles non négociables

**Frontières entre couches.** Elles sont vérifiées par eslint, pas par la discipline :

| Couche            | Peut importer                                              | Ne peut pas            |
| ----------------- | ---------------------------------------------------------- | ---------------------- |
| `src/lib/`        | `node:*`, autres modules de `lib/`                         | `ink`, `react`         |
| `src/format/`     | rien                                                       | tout le reste          |
| `src/screens/`    | `ink`, `react`, `components/`, `format/`, `lib/`, `types/` | un autre flux d'écrans |
| `src/components/` | `ink`, `react`, `format/`                                  | `lib/`, `screens/`     |

**Si une logique métier dépasse 5 lignes dans un écran, elle part dans `lib/`.** Et aucun `process.env` dans `screens/` : un réglage d'environnement passe toujours par une fonction nommée de `lib/`.

**Pas d'exception levée sur les chemins normaux.** Les fonctions renvoient un résultat typé — `{ kind: "ok", … } | { kind: "error", code }` — pas une exception à rattraper. Voir `src/lib/fs/applyRenames.ts` comme référence.

**Toute fonction asynchrone qui touche au disque ou au réseau propage un `AbortSignal`**, et tout `useEffect` asynchrone garde un drapeau `cancelled` pour ne pas écrire dans un composant démonté.

**Toute écriture de fichier est atomique** : fichier temporaire, puis renommage.

**Le code est en anglais** — noms, types, commentaires. Les textes affichés à l'utilisatrice sont en français, et c'est le seul endroit où le français apparaît.

**Par défaut, pas de commentaire.** On en écrit un quand le _pourquoi_ n'est pas évident : un contournement, un invariant subtil, une contrainte cachée. Jamais pour redire ce que le code fait, jamais pour raconter un changement en cours — c'est le rôle du message de commit.

## Tests

La couche `lib/` et `format/` visent 100 % de couverture. Les écrans sont testés au mieux.

`ink-testing-library` ne couvre que le parcours nominal. **Les flux interactifs se testent à la main**, dans `/tmp/chiro-demo`. Ne jamais affirmer qu'une interface fonctionne sans l'avoir vue tourner — le dire explicitement quand ça n'a pas été fait.

## Publier une version

Pousser un tag `vX.Y.Z` déclenche `.github/workflows/release.yml` : les deux binaires sont construits sur des runners natifs, passent `--self-test`, et sont publiés en GitHub Release avec leurs sommes de contrôle.

```bash
git tag v0.1.0
git push origin v0.1.0
```

Le workflow réécrit `package.json` avec la version du tag avant de construire — sans quoi le binaire n'afficherait pas la bonne version.
