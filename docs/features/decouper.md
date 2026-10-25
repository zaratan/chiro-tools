# Découper les enregistrements (pour Tadarida)

Découpe chaque enregistrement en fichiers de 5 secondes de temps réel, avec les métadonnées attendues par la chaîne Vigie-Chiro. Remplace l'étape Kaleidoscope du protocole Point Fixe.

## Ce que ça fait

Chaque `.wav` du dossier est découpé en fichiers plus courts, écrits dans un sous-dossier `processed/`. **Vos fichiers d'origine ne sont jamais modifiés ni supprimés.**

chiro lit la fréquence d'échantillonnage dans l'en-tête de chaque enregistrement et choisit tout seul. Vous n'avez rien à répondre :

| Enregistrements                                    | Reconnus à                                   | Ce qui se passe                              |
| -------------------------------------------------- | -------------------------------------------- | -------------------------------------------- |
| **déjà ralentis 10×** (boîtier PaRec réglé en X10) | une fréquence Teensy X10 (38 400 Hz, etc.)   | le son est découpé tel quel                  |
| **à ralentir 10×** (AudioMoth, PaRec réglé en X1…) | une fréquence de 24 000 Hz ou plus, hors X10 | le son est d'abord ralenti ×10, puis découpé |

Le boîtier PaRec n'enregistre pas toujours en ralenti : c'est un réglage de son menu. Le nom du fichier ne le dit pas, la fréquence si. Le mode retenu s'affiche sur l'écran de confirmation.

Un dossier qui mélange les deux sortes est refusé : rangez-les dans deux dossiers. Un enregistrement dont la fréquence ne correspond à aucun enregistreur connu arrête aussi le découpage : chiro le liste, vous le déplacez dans un autre dossier, puis vous relancez.

Dans les deux cas la sortie est en temps étendu ×10, et chaque fichier produit contient **5 secondes de son réel**, soit 50 secondes sur la durée affichée par un lecteur. C'est la convention Kaleidoscope, et c'est ce que ChiroSurf et Tadarida attendent.

## Le son n'est pas ré-encodé

Le découpage recopie les échantillons tels quels. Seul l'en-tête du fichier change (la fréquence d'échantillonnage déclarée, pour l'expansion temporelle). Il n'y a **aucune perte de qualité**, et c'est vérifié automatiquement à chaque build par une comparaison octet par octet.

Chaque fichier produit reçoit aussi ses métadonnées GUANO et wamd (la date et l'heure de l'enregistrement d'origine), reconstituées depuis le nom du fichier source.

## Vitesse

Le découpage est lourd en calcul. chiro utilise plusieurs cœurs de votre machine en parallèle.

Si l'outil **sox** est installé, chiro le détecte au démarrage et l'utilise : c'est nettement plus rapide. Installation : `brew install sox` (macOS) ou `sudo apt install sox` (Linux). Ce n'est pas obligatoire — sans sox, le découpage fonctionne, il prend juste plus longtemps.

Ordre de grandeur, mesuré sur une vraie session : une nuit qui demande environ 3 heures sans sox est traitée en une dizaine de minutes avec.

Le temps restant affiché est une estimation. Elle est proche de la réalité, mais elle bouge encore en cours de traitement — ne la lisez pas comme une promesse à la minute près.

Quand sox produit un résultat suspect, chiro s'en aperçoit — il compare trois fichiers témoins avec ceux du mode normal — et refait **tout le lot** sans sox. Vous n'avez rien à faire et rien à surveiller : c'est silencieux, et tracé dans le journal.

## Ce que ça ne fait pas

- **Ça ne descend pas dans les sous-dossiers, sauf un.** Un sous-dossier `Brut` ou `Bruts` (majuscules ou non) est lu sur un seul niveau. Ses fichiers découpés vont dans le même `processed/` à la racine. Ça ignore aussi les fichiers déjà découpés (ceux qui finissent par `_000`, `_001`…). Relancer est bloqué tant que `processed/` contient des fichiers (voir plus bas).
- **Ça refuse les fichiers de plus de 500 Mo.** L'outil charge chaque fichier entièrement en mémoire ; au-delà, il préfère refuser proprement plutôt que de saturer votre machine. Un fichier d'une nuit entière en continu peut dépasser cette limite. Le traitement en flux est au backlog (« Streaming pour fichiers > 500 Mo »).
- **Ça refuse les WAV qui ne sont pas du PCM entier 16 ou 24 bits** (WAV compressés, float, A-law, 8 ou 32 bits), et les fichiers sans son. La règle est la même que sox soit installé ou non. Les `.wac` de Wildlife Acoustics doivent être convertis avant.
- **Les enregistrements stéréo restent groupés.** Les deux canaux ne sont pas séparés en deux fichiers, contrairement à l'option « Split channels » de Kaleidoscope (backlog, « Option split-channels »).
- **La durée de découpe est figée** à 5 secondes réelles. C'est la valeur du protocole Point Fixe ; un autre protocole demanderait de la rendre réglable (backlog, « Durée de découpe paramétrable »).
- **Les métadonnées AudioMoth d'origine** (le texte « Recorded at … by AudioMoth … ») ne sont pas conservées dans les fichiers produits. C'est le comportement de Kaleidoscope aussi (backlog, « Conservation du chunk LIST/INFO »).

## Si ça tourne mal

**Un fichier est illisible ou corrompu.** Il est signalé et le reste du lot continue. L'écran final regroupe les erreurs par type plutôt que de vous lister 300 lignes.

**Vous appuyez sur Ctrl+C.** Le découpage s'arrête et l'écran de fin dit combien d'enregistrements ont été découpés. Vos fichiers d'origine n'ont pas bougé. `processed/` ne garde que les enregistrements comptés à l'écran. Ceux qui étaient en cours n'y laissent aucun fichier. Un enregistrement dont la dernière tranche s'écrivait au moment du Ctrl+C est terminé et compté. Renommez ou supprimez ce dossier avant de relancer. L'écran de fin vous le rappelle.

**`processed/` existe déjà et contient des fichiers.** chiro s'arrête en jaune avant de commencer. Renommez l'ancien dossier ou supprimez-le s'il ne vous sert plus, puis relancez. chiro ne le renomme ni ne le supprime jamais lui-même.

**Un nom contient un espace.** Vigie-Chiro refuse ces noms, chiro s'arrête donc avant de découper. Ce contrôle passe avant celui de `processed/`. L'écran renvoie vers « Préfixer des enregistrements », qui remplace chaque espace par `_`, et rappelle de renommer l'ancien `processed/` s'il existe. Si un fichier brut a déjà une version préfixée dans le dossier, le préfixage ne pourrait que le laisser de côté : l'écran le liste et demande de le retirer du dossier.

**Le même nom existe à la racine et dans `Brut/`.** chiro refuse de continuer et liste les fichiers concernés. Les deux donneraient les mêmes fichiers dans `processed/` et l'un écraserait l'autre. Gardez-en un seul, puis relancez.

**Un souci avec les métadonnées.** Si un outil en aval refuse les fichiers produits, vous pouvez désactiver complètement l'ajout des métadonnées sans réinstaller quoi que ce soit :

```bash
CHIRO_DISABLE_METADATA=1 chiro
```

De même, `CHIRO_DISABLE_FASTPATH=1` force le mode sans sox.

## Ce qui a été vérifié

**Les fichiers produits sont relus correctement par ChiroSurf et analysés par Tadarida.** C'est la vérification qui compte pour ce flux, et elle est passée sur de vraies sessions : durée juste, métadonnées lues, pas de « fichiers compactés au début ».

La conformité aux métadonnées GUANO et wamd est par ailleurs établie octet par octet contre un fichier de référence produit par Kaleidoscope, et vérifiée automatiquement à chaque build.
