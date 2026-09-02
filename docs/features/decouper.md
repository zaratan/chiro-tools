# Découper les enregistrements (pour Tadarida)

Découpe chaque enregistrement en fichiers de 5 secondes de temps réel, avec les métadonnées attendues par la chaîne Vigie-Chiro. Remplace l'étape Kaleidoscope du protocole Point Fixe.

## Ce que ça fait

Chaque `.wav` du dossier est découpé en fichiers plus courts, écrits dans un sous-dossier `processed/`. **Vos fichiers d'origine ne sont jamais modifiés ni supprimés.**

Deux modes, choisis à l'écran de saisie :

| Mode       | Pour qui                                            | Ce qui se passe                             |
| ---------- | --------------------------------------------------- | ------------------------------------------- |
| **Teensy** | enregistreurs qui enregistrent déjà en temps étendu | le son est découpé tel quel                 |
| **Autre**  | AudioMoth et détecteurs full-spectrum               | le son est d'abord étendu ×10, puis découpé |

Dans les deux cas la sortie est en temps étendu ×10, et chaque fichier produit contient **5 secondes de son réel**, soit 50 secondes sur la durée affichée par un lecteur. C'est la convention Kaleidoscope, et c'est ce que ChiroSurf et Tadarida attendent.

## Le son n'est pas ré-encodé

Le découpage recopie les échantillons tels quels. Seul l'en-tête du fichier change (la fréquence d'échantillonnage déclarée, pour l'expansion temporelle). Il n'y a **aucune perte de qualité**, et c'est vérifié automatiquement à chaque build par une comparaison octet par octet.

Chaque fichier produit reçoit aussi ses métadonnées GUANO et wamd — la date et l'heure de l'enregistrement d'origine, le modèle d'enregistreur — reconstituées depuis le nom du fichier source.

## Vitesse

Le découpage est lourd en calcul. chiro utilise plusieurs cœurs de votre machine en parallèle.

Si l'outil **sox** est installé, chiro le détecte au démarrage et l'utilise : c'est nettement plus rapide. Installation : `brew install sox` (macOS) ou `sudo apt install sox` (Linux). Ce n'est pas obligatoire — sans sox, le découpage fonctionne, il prend juste plus longtemps.

Ordre de grandeur, mesuré sur une vraie session : une nuit qui demande environ 3 heures sans sox est traitée en une dizaine de minutes avec.

Le temps restant affiché est une estimation. Elle est proche de la réalité, mais elle bouge encore en cours de traitement — ne la lisez pas comme une promesse à la minute près.

Quand sox produit un résultat suspect, chiro s'en aperçoit — il compare trois fichiers témoins avec ceux du mode normal — et refait **tout le lot** sans sox. Vous n'avez rien à faire et rien à surveiller : c'est silencieux, et tracé dans le journal.

## Ce que ça ne fait pas

- **Ça ne descend pas dans les sous-dossiers**, et ça ignore les fichiers déjà découpés (ceux qui finissent par `_000`, `_001`…). Relancer sur un dossier déjà traité ne fait pas de doublons.
- **Ça refuse les fichiers de plus de 500 Mo.** L'outil charge chaque fichier entièrement en mémoire ; au-delà, il préfère refuser proprement plutôt que de saturer votre machine. Un fichier d'une nuit entière en continu peut dépasser cette limite. Le traitement en flux est au backlog (« Streaming pour fichiers > 500 Mo »).
- **Ça refuse les WAV compressés.** Seul le PCM non compressé est accepté. Les `.wac` de Wildlife Acoustics doivent être convertis avant.
- **Les enregistrements stéréo restent groupés.** Les deux canaux ne sont pas séparés en deux fichiers, contrairement à l'option « Split channels » de Kaleidoscope (backlog, « Option split-channels »).
- **La durée de découpe est figée** à 5 secondes réelles. C'est la valeur du protocole Point Fixe ; un autre protocole demanderait de la rendre réglable (backlog, « Durée de découpe paramétrable »).
- **Les métadonnées AudioMoth d'origine** (le texte « Recorded at … by AudioMoth … ») ne sont pas conservées dans les fichiers produits. C'est le comportement de Kaleidoscope aussi (backlog, « Conservation du chunk LIST/INFO »).

## Si ça tourne mal

**Un fichier est illisible ou corrompu.** Il est signalé et le reste du lot continue. L'écran final regroupe les erreurs par type plutôt que de vous lister 300 lignes.

**Vous appuyez sur Ctrl+C.** Le traitement s'arrête, les fichiers déjà écrits sont conservés, et aucun fichier incomplet ne reste dans `processed/`. Relancer reprend là où vous en étiez.

**`processed/` existe déjà.** chiro vous prévient en jaune avant de commencer et vous propose de renommer l'ancien dossier — il ne le supprime jamais lui-même.

**Un souci avec les métadonnées.** Si un outil en aval refuse les fichiers produits, vous pouvez désactiver complètement l'ajout des métadonnées sans réinstaller quoi que ce soit :

```bash
CHIRO_DISABLE_METADATA=1 chiro
```

De même, `CHIRO_DISABLE_FASTPATH=1` force le mode sans sox.

## Ce qui a été vérifié

**Les fichiers produits sont relus correctement par ChiroSurf et analysés par Tadarida.** C'est la vérification qui compte pour ce flux, et elle est passée sur de vraies sessions : durée juste, métadonnées lues, pas de « fichiers compactés au début ».

La conformité aux métadonnées GUANO et wamd est par ailleurs établie octet par octet contre un fichier de référence produit par Kaleidoscope, et vérifiée automatiquement à chaque build.
