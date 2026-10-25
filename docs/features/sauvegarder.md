# Sauvegarder les enregistrements découpés (un seul zip)

Réunit tout le contenu de `processed/` dans un fichier zip unique, destiné à la conservation longue durée.

## À quoi ça sert, et en quoi c'est différent du dépôt

Ce flux et le flux de dépôt zippent le même dossier, mais ne servent pas au même besoin :

|           | Dépôt                              | Sauvegarde                         |
| --------- | ---------------------------------- | ---------------------------------- |
| Pour quoi | déposer sur le portail Vigie-Chiro | retrouver une étude dans trois ans |
| Résultat  | plusieurs fichiers de 3,5 Go       | **un seul** fichier de 10 à 20 Go  |
| Où        | `upload/<série>/`                  | `archived/`                        |

Le fichier de sauvegarde utilise le format ZIP64 — celui que le portail refuse. C'est voulu : il n'est pas fait pour être déposé, il est fait pour être rangé.

```
archived/Car340581-2026-Pass1-A1_20260902.zip
```

**Vos fichiers découpés ne sont ni déplacés ni supprimés.** `processed/` reste intact.

## Ce que ça garantit

- **Aucun fichier zip incomplet n'existe jamais.** L'archive est écrite sous un nom temporaire, vérifiée, puis renommée en une seule opération. Si quoi que ce soit échoue — disque plein, Ctrl+C, erreur de lecture — le fichier temporaire est supprimé et `archived/` reste comme avant.
- **L'écriture est confirmée sur le disque** avant que le fichier soit considéré comme terminé. Un disque plein se manifeste souvent bien après l'écriture apparente ; chiro attend la confirmation du système avant de valider.
- **Les accents dans les noms de fichiers sont gérés correctement**, y compris pour les archives lues sous Windows.

## Ce que ça ne fait pas

- **Ça ne vérifie pas l'intégralité du contenu.** La vérification après écriture contrôle la structure de l'archive et un échantillon des fichiers, pas la totalité. Un contrôle complet sur 20 Go prendrait plusieurs minutes pendant lesquelles l'écran serait figé et Ctrl+C sans effet. C'est acceptable tant que rien n'est supprimé ensuite ; ça deviendra obligatoire le jour où `processed/` sera effacé après coup (backlog, « Suppression de `processed/` après zip vérifié »).
- **Ça ne supprime jamais `processed/`.** La sauvegarde s'ajoute, elle ne remplace pas. Sur un disque juste, prévoyez la place des deux.
- **Les raccourcis (liens symboliques) dans `processed/` sont ignorés en silence**, comme pour le dépôt.
- **Ça ne copie pas la sauvegarde ailleurs.** Le fichier reste sur le même disque que vos originaux — donc au même endroit en cas de panne. C'est exactement ce que résout [l'archivage en ligne](./archiver-en-ligne.md).

## Une limite à connaître

**Deux sauvegardes lancées en même temps peuvent se marcher dessus.** Le nom du fichier contient la date mais pas l'heure. Une seconde sauvegarde du même dossier le même jour ne remplace pas la première. Son nom prend un suffixe (`-2`, puis `-3`…) et l'écran de confirmation prévient que le nouveau zip s'ajoutera à côté. Seul un double lancement simultané sur le même dossier, dans deux terminaux, peut écraser. Rien ne vous préviendrait alors.

**Des enregistrements ont un espace dans leur nom.** La sauvegarde les garde tels quels et l'écran du début le signale sans bloquer. Ces noms seraient refusés au dépôt sur Vigie-Chiro.

**Les enregistrements n'ont pas le même préfixe Vigie-Chiro.** La sauvegarde refuse le dossier, qu'il n'ait aucun préfixe ou plusieurs. Le nom du fichier vient de ce préfixe. Sans lui, deux dossiers sauvegardés le même jour porteraient le même nom, et l'archivage en ligne de l'un remplacerait l'autre. L'écran du début indique quoi faire : préfixer, renommer l'ancien `processed/`, redécouper.

## Après la sauvegarde

L'écran de fin vous propose directement d'archiver ce fichier en ligne, avec la touche `A` — à condition que [l'archivage en ligne](./archiver-en-ligne.md) soit configuré. Sinon, la touche n'apparaît pas.

## Ce qui a été vérifié

Le flux est utilisé en production. Le fichier produit a servi de source à un archivage Glacier réel.
