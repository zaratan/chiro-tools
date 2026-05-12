# Vision

## Tagline

> `chiro` outille **toute la préparation des enregistrements** entre la sortie d'enregistreur (Teensy/PaRec ou AudioMoth/full-spectrum) et l'upload sur **Vigie-Chiro** — pas seulement le renommage.

## Le besoin concret

Une utilisatrice participe au programme **Vigie-Chiro**. Pour chaque session de terrain :

1. Elle pose un enregistreur ultrasonore sur un point d'écoute (`A1`, `B2`…) d'un carré géographique (`040962` = un carré du département 04).
2. Elle laisse l'enregistreur tourner (souvent une nuit complète, parfois plusieurs).
3. Elle récupère les `.wav` produits (depuis une carte SD, sur sa machine).
4. **Avant upload** vers Vigie-Chiro, chaque fichier doit :
   - être renommé en ajoutant un préfixe précis : `CarXXXXXX-AAAA-PassN-YY-<nom-original>.wav`
   - **et pour les détecteurs full-spectrum (AudioMoth, SM4, etc.)** être expansé temporellement ×10 (lossless, réécriture du sample rate) puis découpé en morceaux de 5 secondes — étapes habituellement réalisées dans Kaleidoscope.

Aujourd'hui, ces deux étapes se font à la main et avec plusieurs outils, parfois sur des centaines de fichiers par nuit. C'est pénible, propice aux erreurs, et démoralisant après une nuit de terrain.

## Utilisatrice cible

**Primaire** : la conjointe de l'auteur du projet. **Non-experte en informatique**. Confortable avec son Mac et un peu avec le Terminal (suit des recettes données), mais pas avec les arcanes (chemins, permissions, pipes, scripts).

**Secondaire** : ses collègues du réseau Vigie-Chiro. Même profil : naturalistes, bénévoles ou pros du suivi de biodiversité, pas dévs.

**Implications de conception** :

- Pas de jargon. On parle de **dossier**, de **fichier**, d'**année**, pas de cwd, fs, regex.
- Le bon dossier = celui dans lequel elle tape `chiro`. Pas d'argument à apprendre.
- Les libellés sont en **français**, **bienveillants**, **avec un exemple concret** chaque fois que c'est possible.
- Les erreurs ne culpabilisent jamais. Elles expliquent ce qu'il s'est passé et proposent une action.
- L'utilisatrice doit pouvoir **lire** ce qui va se passer **avant** que ça se passe (écran de confirmation explicite avec preview des renommages).
- Aucune opération destructive sans confirmation explicite (Entrée, pas une touche au hasard).
- Si l'outil ne sait pas faire, il le dit. Il ne devine pas, il ne suppose pas.

## Principes de design (rappels permanents)

1. **Sécurité d'abord** : un renommage est par défaut irréversible. On idempotente, on protège des collisions, on n'écrase jamais sans avertir.
2. **Confiance par la transparence** : chaque écran affiche le chemin absolu du dossier ciblé. L'utilisatrice ne devine pas où l'outil agit.
3. **Réversibilité psychologique** : même si on n'a pas d'undo (V2), le format de préfixe **conserve le nom original** en suffixe. Rien n'est "perdu".
4. **Préférer la lenteur à la confusion** : un écran de confirmation supplémentaire vaut mieux qu'un renommage trop rapide qu'on regrette.
5. **Tolérance aux interruptions** : Ctrl+C en plein renommage doit laisser un état cohérent et l'annoncer clairement.
6. **Trace** : chaque session est journalisée dans `~/.chiro/last-run.log`. Quand la conjointe rapporte un bug à son conjoint dév, on a quelque chose à lire.

## Ce que `chiro` n'est PAS

- Pas un outil pour développeurs (pas de flags exotiques, pas de pipe-friendly, pas de mode batch CLI au MVP).
- Pas un éditeur de métadonnées WAV (V2 peut-être). Le découpage écrit des nouveaux fichiers WAV mais n'altère JAMAIS le contenu audio (lossless — seul le header `fmt.sampleRate` change en mode TE×10).
- Pas un uploader Vigie-Chiro (l'upload reste manuel sur le site).
- Pas un outil d'**analyse** acoustique (spectrogramme, classification, ID auto). On prépare les fichiers pour Tadarida/Kaleidoscope — ces outils-là font l'analyse.
- **Pipeline `Teensy`/`AudioMoth` → upload Vigie-Chiro**. Out of scope : visualisation, classification, anything Tadarida does.

## Critère de succès du MVP

> La conjointe de l'auteur, **seule**, sans aide téléphonique, **renomme correctement** une nuit d'enregistrements (50-200 fichiers) en **moins de 2 minutes**, et **sans peur** d'avoir cassé quelque chose.
