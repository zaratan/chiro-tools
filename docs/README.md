# chiro-tools — Documentation

CLI `chiro` pour préparer des enregistrements `.wav` au format **Vigie-Chiro** (programme français de sciences participatives sur les chauves-souris).

## État actuel

**Pré-implémentation.** Ce dossier `docs/` contient la spec figée du MVP. Aucun code n'a encore été écrit. Les phases d'implémentation sont décrites dans [`roadmap.md`](./roadmap.md).

## Public visé par cette documentation

Cette doc est destinée à servir de **source de vérité unique** pour les sessions d'implémentation futures (humain ou Claude). Elle doit permettre d'attaquer la **Phase 0 (Outillage)** sans avoir à poser de question.

## Ordre de lecture recommandé

1. **[`vision.md`](./vision.md)** — Qui utilise l'outil, pourquoi, et les principes de design qui en découlent. À lire en premier pour internaliser la cible (utilisatrice non-tech).
2. **[`spec.md`](./spec.md)** — Spec fonctionnelle : format du préfixe, 4 écrans du wizard, règles métier, cas dégradés. C'est le contrat.
3. **[`ux.md`](./ux.md)** — Wordings français prêts à coller, conventions visuelles Ink, navigation clavier. Ne pas réinventer les libellés.
4. **[`architecture.md`](./architecture.md)** — Stack, structure du code, build, distribution macOS+Linux, signature, logging.
5. **[`roadmap.md`](./roadmap.md)** — Phases 0 → 4 + V2. Critères de sortie de chaque phase.

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
