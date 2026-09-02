# Roadmap

Ce document sert à **décider quoi faire ensuite**. Il ne raconte pas ce qui a été fait : le détail technique des phases livrées vit dans [`architecture.md`](./architecture.md) et [`../CLAUDE.md`](../CLAUDE.md), et git garde l'historique.

## 1. Où on en est

Version `0.1.0`. Cinq flux dans le menu, 1083 tests sur 102 fichiers, deux binaires (macOS arm64, Linux x64) publiés par tag.

| Phase | Ce que ça a apporté                                                       | Détails                                   |
| ----- | ------------------------------------------------------------------------- | ----------------------------------------- |
| 0     | Stack validée : Bun + Ink + React 19, `bun --compile` en binaire autonome | `architecture.md` § Stack                 |
| 1     | Couche métier pure en TDD : scan, plan de renommage, application          | `architecture.md` § Structure du repo     |
| 2     | TUI Ink : menu, wizard préfixage, state machine, Ctrl+C sûr               | `architecture.md` § State machine         |
| 3     | Wordings calibrés pour la cible non-tech                                  | [`ux.md`](./ux.md)                        |
| 4     | Distribution : GitHub Actions, 2 binaires par tag, `install.sh`           | `architecture.md` § Build, § Distribution |
| 4.6   | Self-update depuis le menu + hint au boot (cache 6 h)                     | `CLAUDE.md` § Self-update                 |
| 5     | **Découper les enregistrements** : split + TE ×10, non-destructif         | `architecture.md` § Lib audio             |
| 6     | Performance : worker pool (3–6×) + fast-path sox (~22×)                   | `architecture.md` § Performance pipeline  |
| 7     | Découpe à 50 s output (5 s réel) + métadonnées GUANO/wamd                 | `CLAUDE.md` § Découpage et métadonnées    |
| —     | Durcissement post-audit + `--self-test` du binaire compilé                | `architecture.md` § Safety nets           |
| 8     | **Sauvegarder** : `processed/` → un zip unique (ZIP64 nominal)            | `architecture.md` § Module `lib/archive`  |
| 9     | **Déposer** : série de volumes 3,5 Go sans ZIP64                          | `architecture.md` § Série de volumes      |
| 10    | **Archiver en ligne** : Scaleway Glacier via rclone (optionnel)           | `architecture.md` § Module `lib/offsite`  |

La chaîne complète est validée en conditions réelles : une série de volumes déposée sur le portail Vigie-Chiro, et un zip de sauvegarde archivé en classe Glacier sur Scaleway. Ce ne sont plus des hypothèses.

## 2. Prochain chantier — Phase 11 : dépôt direct via l'API Vigie-Chiro

**Objectif** : supprimer le dépôt manuel. Aujourd'hui, après le découpage, l'utilisatrice crée une série de zips, ouvre le portail, et dépose les volumes un par un — plusieurs heures d'attention pour une session. Le portail expose une API (backend Eve/Flask, [Scille/vigiechiro-api](https://github.com/Scille/vigiechiro-api)) qui permet de créer la participation, d'uploader les WAV et de déclencher l'analyse Tadarida depuis un programme.

Faisabilité **démontrée** par [ChiroTool](https://github.com/kevin-guille/ChiroTool), qui le fait en production chez plusieurs utilisateurs.

Découpage sur le modèle de la Phase 10 — dont la sous-phase de mesure a invalidé deux affirmations du plan avant la première ligne de `src/`, et c'est exactement pour ça qu'elle passe en premier.

### 11.0 — Mesure, avant toute ligne de `src/`

Contre l'API réelle, sur un compte de test :

- authentification (HTTP Basic, token en username, mot de passe vide) ;
- création d'une participation, upload d'un WAV (voie simple **et** multipart S3), `trigger_compute`, polling de l'état ;
- comportement sur les cas dégradés : token expiré, coupure en cours d'upload, participation déjà existante.

Traces réelles committées dans `test-data/`, comme `test-data/rclone-stats/`, avec un README des invariants observés.

**Accélérateur** : `vigiechiro_api.py` de ChiroTool est sous licence MIT et documente l'API mieux que sa documentation officielle — sérialisation RFC 1123 forcée en anglais (sinon Eve refuse les dates sous une locale française), ETag obligatoire sur les PUT, pagination Eve, politique de retry séparée avant-plan/arrière-plan. **À lire comme référence, avec attribution. Pas à copier.**

### 11.A — Le mur du token

**Risque produit n° 1 du chantier, à trancher avant d'écrire un écran.** Le token s'obtient aujourd'hui en ouvrant les outils développeur du navigateur et en lisant `auth-session-token` dans le `localStorage`. Pour notre utilisatrice, c'est infranchissable seule — et si on n'a pas de réponse acceptable, la Phase 11 ne vaut pas mieux que le dépôt manuel qu'elle remplace.

Pistes à explorer et à arbitrer : configuration faite une fois par un tiers ; assistant guidé avec capture d'écran ; stockage dans le trousseau macOS.

### 11.B → 11.E

Aligné sur le découpage 10.A1 / 10.A2 / 10.B / 10.C : logique pure d'abord, puis ce qui parle au réseau, puis les écrans, puis les docs.

### Question ouverte, à ne pas trancher maintenant

Si la Phase 11 aboutit, le flux « Créer les zips à déposer » devient une roue de secours (portail en panne, API cassée par une mise à jour). Le flux « Sauvegarder » et l'archivage Glacier, eux, restent : ils servent un besoin différent — retrouver une étude trois ans plus tard.

## 3. Backlog

Estimations conservées depuis leur évaluation initiale.

### Confort d'usage

| #   | Item                                                                                                                                                                                                                                                                                                                                                       | Estim. |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | **Pré-remplissage de la dernière session** (`~/.chiro/last-session.json`). Gain UX majeur nuit après nuit.                                                                                                                                                                                                                                                 | 2 h    |
| 2   | **Annuler la dernière opération** (journal `.chiro-undo.json` posé au moment du rename). Rassurance maximale.                                                                                                                                                                                                                                              | 4 h    |
| 3   | **Manifest de session dans le dossier traité** — un `.chiro-session.json` qui liste ce qui a été fait et quels fichiers ont été produits. Rend chaque étape idempotente et reprenable, et **débloque l'item 15** : ses préconditions « re-scanner `processed/` juste avant » et « liste nominative des entrées archivées » deviennent triviales.           | 0,5 j  |
| 4   | **Écran « Vérifier un dossier »** — verdict PASS / PARTIAL / FAIL par invariant, lançable après coup sur un dossier douteux. ⚠️ Choisir les invariants pour attraper le cas _silencieux_ : celui de ChiroTool retourne PASS sur une perte de fichier réelle, parce qu'il vérifie « chaque source a au moins un segment » au lieu de « tous ses segments ». | 1 j    |
| 5   | **Auto-détection de l'enregistreur** depuis le header (`fmt.sampleRate` : 38 400 → `preserve`, > 100 000 → `expand-10x`). Évite l'écran de saisie du flux Découper.                                                                                                                                                                                        | 2 h    |
| 6   | **Lecture des métadonnées WAV** pour suggérer l'année et alerter en cas d'incohérence.                                                                                                                                                                                                                                                                     | 1 j    |
| 7   | **Mode batch CLI** : `chiro vigie --carre 040962 --pass 3 --point A1`.                                                                                                                                                                                                                                                                                     | 0,5 j  |
| 8   | **Linux arm64 / macOS Intel x64** — conditionnel : seulement si un collègue en a besoin.                                                                                                                                                                                                                                                                   | 1 h    |

### Découpage

| #   | Item                                                                                                                                                                                                                                                                                     | Estim.        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 9   | **Stabiliser l'ETA du découpage** — l'estimation est proche de la réalité mais oscille encore sensiblement en cours de run. Le lissage byte-weighted (`etaTracker.ts`) mérite une passe : fenêtre glissante, ou amortissement des variations entre fichiers de tailles très différentes. | à évaluer     |
| 10  | **Streaming pour fichiers > 500 Mo** — `wavefile` charge tout en RAM ; parseur RIFF streaming (~150 lignes).                                                                                                                                                                             | 1 j           |
| 11  | **Option split-channels** pour détecteurs stéréo (SM2BAT+, SM4BAT), alignée sur Kaleidoscope.                                                                                                                                                                                            | 2 h           |
| 12  | **Durée de découpe paramétrable** — aujourd'hui 50 s output / 5 s réel, figé. Nécessaire pour un protocole autre que Point Fixe.                                                                                                                                                         | 1 h           |
| 13  | **Modes TE additionnels** (×8, ×20) si un détecteur l'exige.                                                                                                                                                                                                                             | 30 min / mode |
| 14  | **Conservation du chunk `LIST/INFO`** (métadonnées AudioMoth), aujourd'hui droppé — cohérent avec Kaleidoscope. Seulement si Tadarida en a besoin.                                                                                                                                       | 4 h           |

### Archive

| #   | Item                                                                                                                                    | Estim. |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 15  | **Suppression de `processed/` après zip vérifié** — le vrai gain d'espace disque. Préconditions non négociables, détaillées ci-dessous. | 1,25 j |

**Préconditions de l'item 15** — aucune n'est optionnelle :

1. `verifyZipArchive` en `crcMode: "full"`, avec `AbortSignal` propagé et progression émise : en `full` sur 10–20 Go la vérification dure plusieurs minutes, pendant lesquelles la TUI serait figée et Ctrl+C inopérant.
2. ~~`fsync` du répertoire `archived/`~~ — **soldée en Phase 9**, remontée en `durable: boolean`. Le flux destructif devra exiger `durable === true`.
3. Écran de confirmation explicite, distinct du flux actuel : la réassurance « rien n'est supprimé » disparaît, tout le wording est à revoir.
4. Re-scanner `processed/` juste avant la suppression et ne supprimer que l'intersection avec ce qui a été archivé — `opts.entries` vient du scan de l'écran Constat, potentiellement plusieurs minutes plus tôt.
5. `createZipArchive` doit retourner la **liste nominative** des entrées archivées, pas un compteur, sans quoi (4) n'est pas implémentable.
6. **Garde-fou de ratio** : bloquer la suppression si elle dépasse un seuil du total, écrire les statistiques **avant** toute suppression, et ne pas marquer l'opération faite en cas de blocage. _(Repris du `cleanup.py` de ChiroTool, où le garde-fou est testé sur ses deux branches.)_

> La Phase 10 ne facilite **rien** de tout ça et ne doit pas être invoquée pour l'assouplir. « Le CRC intégral local est moins critique, on a une copie en ligne » est faux : la copie en ligne n'a jamais été vérifiée autrement que par sa **taille** (`verified: "size-match" | "unavailable"`, jamais un CRC). Elle ne prouve rien de plus que le zip local qu'elle duplique.

## 4. Écarté, et pourquoi

Consigné ici pour ne pas re-litiger.

- **Brew tap** et **internationalisation (EN)** — ne servent qu'à élargir l'audience. L'audience visée reste l'utilisatrice cible et son cercle proche.
- **Support Titley Anabat / Wildlife SM4** — malgré ChiroTool qui les gère et y gagne des utilisateurs. Même raison. À rouvrir si quelqu'un du cercle le demande (~3 h : un parseur de nom de plus).
- **`--self-test` étendu au zip ou à la série** — ni asset bundlé ni worker, donc aucun piège de `bun --compile` à couvrir. Ne pas le « compléter » par réflexe de symétrie.
- **`A-LIRE.txt` dans le dossier de série** (liste des fichiers + cases à cocher pour suivre un dépôt de plusieurs heures) — à re-poser après un dépôt réel. Devient sans objet si la Phase 11 aboutit.
- **Upload API comme hors-scope définitif** — position tenue jusqu'ici par `vision.md`, abandonnée : la douleur du dépôt manuel est réelle et la faisabilité est démontrée. C'est devenu la Phase 11.

## 5. Définition de « Terminé »

Le MVP est livrable quand :

- le `README.md` permet à un naturaliste non-tech d'installer et d'utiliser l'outil sans intermédiaire technique ;
- le critère de succès de [`vision.md`](./vision.md) est tenu : **conjointe seule, < 2 min, sans peur**.

⚠️ Ce critère de succès ne décrit plus que le flux de préfixage, alors que l'outil en a cinq. Il devra être réécrit quand la Phase 11 aura fixé le périmètre final — pas avant, pour ne pas viser une cible mouvante.
