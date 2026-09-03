# Créer les zips à déposer sur Vigie-Chiro

Prépare le contenu de `processed/` en une série de fichiers zip acceptés par le portail Vigie-Chiro.

## Pourquoi une série et pas un seul fichier

Le portail Vigie-Chiro **refuse le format ZIP64**, une extension du format zip qui se déclenche automatiquement dès qu'une archive devient volumineuse. Un dossier `processed/` réel (10 à 20 Go) tombe dedans systématiquement.

chiro produit donc une série de fichiers de **3,5 Go maximum**, chacun garanti sans ZIP64. Chaque fichier est déposable tel quel sur le portail.

```
upload/
└── Car340581-2026-Pass1-A1_20260902/
    ├── Car340581-2026-Pass1-A1_20260902_part1.zip
    ├── Car340581-2026-Pass1-A1_20260902_part2.zip
    └── Car340581-2026-Pass1-A1_20260902_part3.zip
```

**Vos fichiers découpés ne sont ni déplacés ni supprimés.** `processed/` reste intact.

## Ce à quoi vous devez vous attendre pendant le run

**Le nombre de fichiers zip est inconnu jusqu'à la fin.** L'écran affiche « Fichier zip 3 » sans total. Ce n'est pas un oubli : chiro décide de passer au fichier suivant selon la taille **réellement écrite**, pas selon une estimation. Le taux de compression varie (environ 36 % sur de l'audio de chauve-souris), et prévoir le découpage à l'avance remplirait les fichiers au tiers de leur capacité.

Pour la même raison, les numéros `part1`, `part2`… ne sont attribués qu'à la toute fin, quand la série est complète.

**C'est tout ou rien.** Si quelque chose échoue en cours de route, ou si vous faites Ctrl+C, **aucun** fichier zip n'apparaît dans `upload/`. Vous ne vous retrouvez jamais avec une série incomplète qu'il faudrait départager. Le travail en cours se fait dans un dossier caché, publié en une seule fois quand tout est prêt.

## Vérifications avant publication

Avant qu'un seul fichier soit visible, chiro contrôle :

- que chaque fichier zip contient bien tout ce qu'on lui a demandé d'y mettre, nom par nom ;
- que la réunion de tous les fichiers couvre l'intégralité de `processed/` — un fichier ne peut pas disparaître entre deux volumes ;
- qu'aucun fichier n'utilise le ZIP64, vérifié dans la structure binaire de l'archive elle-même.

Si l'une de ces vérifications échoue, rien n'est publié.

## Ce que ça ne fait pas

- **Ça ne dépose pas à votre place.** Il faut ouvrir le portail et déposer les fichiers un par un. Le dépôt automatique via l'API Vigie-Chiro est le prochain grand chantier ([`roadmap.md`](../roadmap.md) § Phase 12).
- **Ça ne suit pas votre avancement.** Sur une série de six fichiers, rien ne vous dit lequel vous avez déjà déposé. Un pense-bête déposé à côté des fichiers a été envisagé puis écarté ; à reconsidérer.
- **Les raccourcis (liens symboliques) dans `processed/` sont ignorés en silence.** Seuls les vrais fichiers sont archivés. C'est une limite assumée : personne ne met de raccourci dans un dossier produit par chiro, mais si vous le faisiez, rien ne vous préviendrait.
- **Ça ne supprime jamais `processed/`**, même une fois les fichiers zip créés et vérifiés. Le gain de place demande des garanties supplémentaires qui ne sont pas en place (backlog, « Suppression de `processed/` après zip vérifié »).

## Si ça tourne mal

**Le disque est plein.** L'erreur est détectée avant qu'un fichier incomplet soit publié. Rien n'apparaît dans `upload/`.

**Un dossier du même nom existe déjà.** chiro ne l'écrase pas : il ajoute un suffixe au moment de publier.

**Une série précédente s'est arrêtée brutalement** (coupure de courant, `kill -9`). Le dossier de travail caché qu'elle a laissé est nettoyé automatiquement au démarrage du flux suivant — mais seulement s'il a plus de 24 heures et que le programme qui l'a créé n'existe plus. Le nettoyage supprime fichier par fichier, uniquement les noms qu'il s'attend à trouver, et renonce s'il trouve autre chose.

**Vous voulez des fichiers plus petits ou plus gros.** La variable `CHIRO_MAX_VOLUME_BYTES` permet de changer la taille limite. Elle est bornée entre 1 Mio et environ 4 Go — au-delà, le ZIP64 redeviendrait inévitable.

## Ce qui a été vérifié

Une série complète a été **déposée avec succès sur le portail Vigie-Chiro**. C'est le seul test qui compte pour ce flux, et il est passé.

Chaque fichier zip produit est par ailleurs validé en intégration continue par trois extracteurs indépendants (`unzip`, `python3 -m zipfile`, `bsdtar`) — si l'un des trois n'arrive pas à l'ouvrir, la construction échoue.
