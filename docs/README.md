# chiro-tools — Documentation

CLI `chiro` pour préparer des enregistrements `.wav` au format **Vigie-Chiro** (programme français de sciences participatives sur les chauves-souris).

## État actuel

**En production.** Cinq flux livrés (préfixer, découper, déposer, sauvegarder, archiver en ligne), utilisés sur de vraies sessions de terrain. Ce dossier contient la conception du projet ; ce qui vient ensuite est dans [`roadmap.md`](./roadmap.md).

## Deux publics, deux endroits

Cette documentation-ci sert de **source de vérité unique pour la conception** — pour les sessions de développement futures, humaines ou assistées.

Elle ne s'adresse pas à l'utilisatrice de l'outil : pour ça, il y a le [`README.md`](../README.md) racine et [`features/`](./features/), une page par fonction, qui disent aussi ce que chaque fonction ne fait pas.

## Ordre de lecture recommandé

1. **[`vision.md`](./vision.md)** — Qui utilise l'outil, pourquoi, et les principes de design qui en découlent. À lire en premier pour internaliser la cible (utilisatrice non-tech).
2. **[`spec.md`](./spec.md)** — Spec fonctionnelle : format du préfixe, écrans des wizards, règles métier, cas dégradés. C'est le contrat.
3. **[`ux.md`](./ux.md)** — Wordings français prêts à coller, conventions visuelles Ink, navigation clavier, règles de vocabulaire figées. Ne pas réinventer les libellés.
4. **[`architecture.md`](./architecture.md)** — Stack, structure du code, décisions d'architecture, build, distribution, logging.
5. **[`roadmap.md`](./roadmap.md)** — Où on en est, le prochain chantier, le backlog, et ce qui a été écarté.

Deux documents complètent cet ensemble hors de `docs/` : [`CLAUDE.md`](../CLAUDE.md) (les règles dures et les pièges déjà payés) et [`CONTRIBUTING.md`](../CONTRIBUTING.md) (comment développer et publier).

## Glossaire

| Terme           | Définition                                                                                                                                                                                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vigie-Chiro** | Programme français de sciences participatives, coordonné par le Muséum National d'Histoire Naturelle, pour le suivi des chiroptères (chauves-souris) par enregistrements ultrasonores. Voir [vigiechiro.herokuapp.com](https://vigiechiro.herokuapp.com/). |
| **Carré**       | Maillage géographique de 2×2 km où l'utilisatrice pose ses enregistreurs. Code à 6 chiffres (dept sur 2 chiffres + 4 chiffres).                                                                                                                            |
| **Point**       | Position d'écoute précise au sein du carré. Code = 1 lettre + 1 chiffre (`A1`, `C2`…).                                                                                                                                                                     |
| **Passage**     | Numéro d'ordre de la session d'enregistrement sur le carré dans l'année (1 = 1ʳᵉ session, 2 = 2ᵉ, etc.).                                                                                                                                                   |
| **`.wav`**      | Format brut des enregistrements ultrasonores que l'utilisatrice récupère depuis ses enregistreurs (souvent sur carte SD).                                                                                                                                  |
| **Préfixe**     | Chaîne ajoutée en début de chaque nom de fichier au format `CarXXXXXX-AAAA-PassN-YY-`.                                                                                                                                                                     |
| **TUI**         | Text User Interface — interface dans le terminal. Ici fournie par [Ink](https://github.com/vadimdemedes/ink) (React pour terminal).                                                                                                                        |

## Convention de versionnage de cette doc

Toute modification de spec **avant** Phase 1 se fait directement dans ces fichiers (pas de changelog). Une fois Phase 1 démarrée, les changements de spec doivent être annoncés dans le commit + référencés dans un `CHANGELOG.md` à créer.
