# Préfixer des enregistrements pour Vigie-Chiro

Renomme les fichiers `.wav` d'un dossier en leur ajoutant le préfixe attendu par Vigie-Chiro.

## Ce que ça fait

Vous donnez quatre informations — le carré, l'année, le passage, le point — et chaque fichier du dossier est renommé :

```
PaRec12_20250919_200134.wav
→ Car340581-2026-Pass1-A1-PaRec12_20250919_200134.wav
```

Le nom d'origine est **conservé en entier**, à la suite du préfixe. Rien de ce que votre enregistreur a écrit n'est perdu.

## Comment on s'en sert

1. Placez-vous dans le dossier de la nuit : `cd /chemin/vers/ma-nuit`
2. Lancez `chiro`, choisissez « Préfixer des enregistrements pour Vigie-Chiro »
3. chiro compte les fichiers avant de vous demander quoi que ce soit — si vous n'êtes pas dans le bon dossier, vous le voyez tout de suite
4. Remplissez les quatre champs, relisez les trois exemples affichés, validez avec `Entrée`

## Ce qui est vérifié avant de renommer

- **Le dossier est modifiable.** Si vos fichiers sont sur une carte SD en lecture seule, chiro le dit au lieu d'échouer à mi-parcours.
- **Aucun renommage n'écrase un fichier existant.** La vérification a lieu juste avant chaque renommage, pas seulement au moment de la prévisualisation — c'est ce qui rattrape le cas macOS où `photo.wav` et `PHOTO.WAV` sont considérés comme le même nom.
- **Les fichiers qui portent déjà ce préfixe sont laissés tranquilles.** Vous pouvez relancer l'opération sur un dossier à moitié traité sans créer `Car340581-2026-Pass1-A1-Car340581-…`. Seule exception : un nom qui contient un espace.
- **Un autre préfixe est remplacé, après accord.** Vous aviez tapé Passage 1 au lieu de 2 ? Relancez avec 2 : la confirmation montre en jaune les fichiers qui portent l'ancien préfixe, avec un exemple avant et après. `Entrée` remplace l'ancien préfixe par le nouveau. La comparaison tient compte des majuscules.
- **Les espaces deviennent `_`.** Une Teensy réglée avec un préfixe court le complète par des espaces (`PR01 PR1925645_….wav`), et Vigie-Chiro refuse ces noms. Chaque espace devient `_`, à la pose du préfixe comme sur un fichier déjà préfixé. Sur un fichier qui porte déjà ce préfixe, seuls les espaces changent.

## Les règles de saisie

| Champ   | Attendu                        | Exemple  |
| ------- | ------------------------------ | -------- |
| Carré   | exactement 6 chiffres          | `340581` |
| Année   | 4 chiffres, entre 1900 et 2100 | `2026`   |
| Passage | un entier ≥ 1                  | `1`      |
| Point   | une lettre puis un chiffre     | `A1`     |

Le point est automatiquement passé en majuscule. `a1` et `A1` donnent le même résultat.

## Ce que ça ne fait pas

- **Ça ne descend pas dans les sous-dossiers, sauf un.** Les `.wav` du dossier courant sont traités. Ceux d'un sous-dossier `Brut` ou `Bruts` (majuscules ou non) aussi, sur un seul niveau. Ils sont renommés sur place, dans `Brut/`. Un dossier par passage, c'est l'usage prévu.
- **Ça ne touche à rien d'autre que les `.wav`.** Le `LogPR*.txt` que pose votre Teensy est ignoré, pas supprimé.
- **Il n'y a pas d'annulation.** Le renommage est immédiat et définitif. La seule protection est que le nom d'origine reste lisible dans le nouveau nom : vous pouvez toujours refaire le chemin inverse à la main. Une vraie fonction d’annulation est au [backlog](../roadmap.md) (« Annuler la dernière opération »).
- **Ça ne devine pas l'année ni le point** depuis le contenu des fichiers. Seule exception : si les fichiers déjà préfixés du dossier portent tous le même préfixe, la saisie en reprend les valeurs. Sinon vous les saisissez à chaque fois. Le pré-remplissage de la dernière session est au backlog (« Pré-remplissage de la dernière session »).

## Si ça tourne mal

**Vous appuyez sur Ctrl+C en plein renommage.** L'opération en cours se termine, puis chiro s'arrête et vous dit exactement combien de fichiers ont été renommés. Le dossier est dans un état mixte — certains préfixés, d'autres non — mais cohérent : relancer l'opération avec les mêmes valeurs finit le travail sans rien abîmer. Si l'arrêt a eu lieu pendant un premier préfixage, la saisie reprend d'elle-même les valeurs des fichiers déjà renommés. Après un arrêt pendant un remplacement de préfixe, deux préfixes coexistent et la saisie revient vide.

**Le même nom existe à la racine et dans `Brut/`.** chiro refuse de continuer et liste les fichiers concernés. Une fois découpés, les deux donneraient les mêmes fichiers dans `processed/` et l'un écraserait l'autre. Gardez-en un seul, puis relancez.

**Un fichier refuse d'être renommé** (verrouillé par un autre programme, permissions). Les autres sont quand même traités. L'écran final liste ce qui a échoué et pourquoi.

Chaque session laisse une ligne dans `~/.chiro/sessions.jsonl`. C'est le fichier à joindre si vous demandez de l'aide.

## Ce qui n'a pas été vérifié

Rien de particulier sur ce flux : c'est le plus ancien, le plus simple, et il est utilisé à chaque session depuis la première version.
