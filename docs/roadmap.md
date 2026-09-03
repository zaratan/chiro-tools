# Roadmap

Ce document sert à **décider quoi faire ensuite**. Il ne détaille pas ce qui a été fait : le § 1 en donne la carte, le détail technique vit dans [`architecture.md`](./architecture.md) et [`../CLAUDE.md`](../CLAUDE.md), et git garde l'historique.

## 1. Où on en est

Version `0.1.0`. Cinq flux dans le menu — quatre seulement tant que l'archivage en ligne n'est pas configuré, l'entrée étant conditionnelle. 1083 tests sur 102 fichiers, deux binaires (macOS arm64, Linux x64) publiés par tag.

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

## 2. Prochains chantiers

Trois phases, dans cet ordre : **suivre** une campagne (11), **déposer et récupérer** sans re-saisie (12), **post-traiter** les résultats (13).

Elles ont un point commun qui mérite d'être dit franchement : **elles changent la nature de l'outil.** Les phases 0 à 10 ont livré cinq opérations qu'on lance sur un dossier, chacune finissant là où elle a commencé. Les trois suivantes introduisent quelque chose que chiro n'a jamais eu — un état qui survit entre deux lancements, une chaîne dont il faut se souvenir, et une dépendance à un service tiers. D'un utilitaire on passe à un outil de suivi. C'est assumé, et c'est ce qui rend le § 5 nécessaire : la définition de « terminé » ne peut plus être celle du renommage.

### Chantier transverse — avant la Phase 11

Deux prérequis qui ne relèvent pas de la Phase 11 mais sans lesquels elle part sur de mauvaises bases. À livrer seuls, avant.

- **La largeur adaptative.** `width={70}` est écrit en dur dans 39 écrans, pour un terminal de 80×24 qui n'existe plus : les terminaux d'aujourd'hui sont bien plus grands, et une liste de passages doit pouvoir prendre l'espace disponible. Décision : chiro prend la largeur du terminal (`useStdout().columns`), avec un **plancher à 70** en dessous duquel rien ne change — les wordings calibrés à 66 colonnes restent donc valides. Si l'utilisatrice réduit sa fenêtre en dessous du nécessaire, un défilement prend le relais ; c'est la seule situation où il apparaît. Un seul régime de largeur pour toute l'app, jamais deux. Testé à la main écran par écran.
- **Interdire `process.cwd()` hors de `src/index.tsx`, par eslint.** Il n'en existe qu'un dans tout `src/`, passé en prop à chaque écran, et c'est cette propriété qui rend la boucle multi-dossiers possible sans refactor. Huit lignes de configuration pour qu'elle tienne par la machine et non par la discipline.

### Phase 11 — Suivre une campagne multi-dossiers

**Objectif** : ne plus rien oublier quand une semaine de terrain produit une douzaine de dossiers à traiter.

#### Le modèle terrain

**L'unité de tout est le passage.** Un passage = une pose d'un enregistreur sur un point d'écoute d'un carré, avec un numéro. Il a **un dossier, un préfixe, une participation Vigie-Chiro, une sauvegarde**. Il dure le plus souvent une nuit, parfois plusieurs — et dans ce cas c'est l'utilisatrice qui décide si la pose vaut un passage de N nuits ou N passages numérotés. chiro ne tranche pas, il suit ce qu'elle a fait. Vigie-Chiro traite **passage par passage**.

Le cas réel : quatre enregistreurs posés une semaine, relevés trois fois, **douze passages** au retour. Ils n'ont **rien de fiable en commun sauf l'année** : les enregistreurs changent de carré à chaque passage, et deux enregistreurs posés sur un même carré (lieu difficile d'accès, on double le matériel) ont des points différents. Le carré, le point et le numéro de passage varient tous. Un point ne reçoit presque jamais deux passages — d'où l'absence de toute vue « par point ».

Chaque passage traverse la même chaîne de huit étapes — préfixer, découper, créer les fichiers zip, sauvegarder, archiver en ligne, déposer, recevoir les résultats, finir — dont la sauvegarde et l'archivage se mènent en parallèle du dépôt. Une de ces étapes attend **plusieurs jours** : entre le dépôt et les résultats de Tadarida, il ne se passe rien qu'on puisse surveiller.

Rien aujourd'hui ne retient où en est chaque passage. C'est un suivi tenu de tête ou sur un papier, sur douze dossiers, avec des jours d'écart entre les étapes. **Le mode d'échec n'est pas l'erreur, c'est l'oubli** — un passage déposé dont on ne récupère jamais les résultats, ou traité deux fois.

Ce chantier passe **avant** le dépôt automatique (Phase 12) pour deux raisons : le besoin existe dès maintenant, sur des étapes qui resteront manuelles quoi qu'il arrive (le post-traitement, tant que la Phase 13 n'est pas là) ; et il donne à la Phase 12 l'endroit où inscrire ses propres états, plutôt que de l'y ajouter après coup.

#### 11.0 — Mesure API, avant toute ligne de `src/`

Réduite à ce qui conditionne la Phase 11, contre l'API réelle, sur un compte de test :

1. **Une participation vaut-elle un passage, quel que soit son nombre de nuits ?** C'est la compréhension actuelle ; si elle est fausse, c'est le découpage en dossiers qui change, avant qu'une ligne d'écran existe.
2. **Le token : comment on l'obtient, combien de temps il vit.** Si l'obtenir est infranchissable pour l'utilisatrice seule, la Phase 12 peut ne jamais sortir — et l'état « déposé » de la Phase 11 devient alors **déclaré à titre permanent**, pas un provisoire de trois mois. Ça change sa conception.

Une demi-journée. Le reste de la mesure (multipart, cas dégradés, traces) reste en 12.0.

#### Le flux visé

L'utilisatrice range ses enregistrements en un dossier de campagne, **un sous-dossier par passage**, dont le nom est libre :

```
fontainebleau_aut_2026/
├── 123456/
│   └── brut/
│       └── PaRec340581_20260814_223000.wav …
└── 214312/
    └── brut/
        └── PaRec340582_20260814_223104.wav …
```

**Deux fichiers marqueurs, et c'est leur présence qui définit le mode.** Un fichier _de campagne_ dans le dossier parent ; un fichier _de passage_ dans chaque sous-dossier — et ce dernier existe aussi pour un dossier solo, hors de toute campagne : l'état par dossier est le même objet dans les deux modes. Tous deux préfixés d'un point, donc invisibles aux scans existants et jamais embarqués dans un zip.

Elle lance `chiro` dans un dossier. Ce qu'il fait dépend de ce qu'il y trouve, dans cet ordre :

1. **Un fichier de campagne** → mode campagne, directement. La liste des passages est l'écran d'accueil ; le menu actuel n'apparaît pas, puisque ses verbes n'ont plus d'objet tant qu'aucun passage n'est choisi.
2. **Un fichier de passage** → mode solo, directement, avec le menu actuel. Si le dossier parent porte un fichier de campagne, chiro le dit (« ce passage fait partie de `fontainebleau_aut_2026` ») et propose d'y aller — sans jamais y aller tout seul.
3. **Ni l'un ni l'autre** → détection, une seule fois. Pour chaque candidat, le test est `scanDirectory`, qui fusionne déjà un dossier et son `brut/` — donc `campagne/123456/brut/*.wav` est bien vu comme « le sous-dossier `123456` contient des enregistrements » :
   - des `.wav` ici, ou dans un `brut/` ici → **solo** ;
   - sinon, des sous-dossiers qui en contiennent → **campagne** : les passages existent déjà, on les rattache ;
   - sinon, un dossier vide ou sans enregistrements → **proposer d'y préparer une campagne** : elle sait qu'elle va poser quatre enregistreurs, chiro crée les sous-dossiers, chacun avec son `brut/` prêt à recevoir la carte SD et son fichier de passage déjà configuré.

Dans les trois cas, c'est **un écran Constat, pas un sélecteur** : chiro montre ce qu'il a vu — « 12 dossiers contenant des enregistrements », « ce dossier est vide » — et attend `Entrée`. Aucune alternative n'est offerte, le mot « mode » n'atteint jamais l'écran, et **`Échap` signifie « ce n'est pas le bon dossier »** : chiro quitte sans avoir rien écrit. Les marqueurs ne sont posés qu'après `Entrée`. La détection ne se rejoue jamais ensuite : c'est le fichier qui décide, et un moyen de le retirer reste accessible depuis la liste.

**En campagne**, deux temps :

1. **Configuration, passage par passage.** Seule l'année est pré-remplie, parce que c'est la seule chose commune. Carré, numéro de passage et point sont saisis intégralement pour chaque dossier — **rien n'est déduit des fichiers** (décision consignée au § 4). L'aide est ailleurs : les douze lignes se relisent **côte à côte**, alignées, et une coquille saute aux yeux quand elle casse la colonne. À côté de chaque ligne, chiro affiche le **numéro de série de l'enregistreur** lu dans les noms de fichiers (`PaRec340581`) — comme repère pour retrouver où elle a posé ce boîtier, jamais comme source d'une valeur.
2. **La liste des passages**, décrite ci-dessous.

Les sous-dossiers ajoutés ou retirés entre deux lancements sont détectés grâce au recensement que porte le fichier de campagne.

#### Ce que la phase livre

**Un état persistant par dossier traité**, écrit par chacun des flux existants au moment où il réussit. C'est le socle de la phase. Il correspond à l'ancien item « manifeste de session dans le dossier traité » du backlog, absorbé ici.

⚠️ **Il ne débloque pas la suppression de `processed/`, contrairement à ce que ce document a affirmé.** Dans un même run, la liste des entrées archivées est déjà en mémoire et prouvée exacte : il n'y a rien à rendre trivial. Le manifeste ne sert que si la suppression est **différée** à un autre run — et c'est précisément le cas où il est le plus dangereux, puisqu'il affirme alors un état du disque qui a eu le temps de changer. La Phase 11 transforme donc un problème « liste fraîche en mémoire » en problème « liste sur disque, peut-être périmée » : le re-scan et le garde-fou de ratio en deviennent **plus** nécessaires, pas moins.

Sa forme est décidée :

- **Dans chaque dossier de passage, deux objets et pas un** : la **configuration** (le préfixe), écrite une fois et relue ; et l'**avancement**, un journal append-only — une ligne par fait, jamais réécrit. Les réunir dans un seul fichier réécrit exposerait la config à chaque écriture d'avancement, et deux instances de chiro s'effaceraient l'une l'autre.
- **Chaque fait porte une empreinte** de ce qu'il constate — nombre de fichiers, somme des tailles, mtime le plus récent — pour détecter qu'un dossier a bougé hors de chiro : de nouveaux `.wav` déposés après le découpage, un `processed/` supprimé à la main. Une ligne dont l'empreinte a changé passe en « à vérifier » au lieu de rester verte.
- **Le fichier de campagne ne porte aucun avancement.** L'avancement de la campagne est un scan des passages, pas une donnée. Il porte ce qui n'a pas d'autre domicile — le mode, l'année, et le **recensement** des sous-dossiers connus (nom, date de première vue). Un sous-dossier recensé mais disparu du disque **reste dans la liste**, marqué introuvable en `dimColor`, avec son historique ; elle peut le retirer d'une touche. Jamais de suppression silencieuse d'une trace.
- **Un dossier de passage ne pointe jamais vers sa campagne.** C'est la campagne qui recense ses passages. Un dossier sorti de sa campagne redevient naturellement solo, sans lien cassé.
- **L'état et `~/.chiro/sessions.jsonl` ont deux rôles distincts et indépendants.** Le journal global reste ce qu'il est — un journal de diagnostic à joindre en cas de bug, jamais relu par chiro. L'état de passage est local, porté par le dossier, et c'est le seul que chiro relit. Aucun n'est dérivé de l'autre.
- **Chaque affichage est réconcilié contre le disque.** Une ligne verte dit ce qui est constaté maintenant — `processed/` existe-t-il vraiment, `archived/*.zip` est-il là — jamais ce qui a été écrit un jour. Un `readdir` par passage à l'ouverture de la liste, coût négligeable. C'est la leçon de la Phase 10 (refus de détecter « déjà en ligne » par relecture d'un journal), appliquée ici dans l'autre sens. À la création du fichier de passage sur un dossier déjà traité, c'est aussi ce qui donne l'avancement initial : constaté, pas vide.
- **Le format est versionné, et un binaire antérieur qui ne le comprend pas refuse d'écrire.** Il lit ce qu'il peut, l'affiche en lecture seule, et le dit : « ce suivi a été créé par une version plus récente de chiro — mettez chiro à jour ». Jamais de réécriture tronquée. Le cas est réel : l'auto-check de mise à jour échoue en silence, et un disque passe de main en main.

**La configuration** décrite ci-dessus, et **une liste des passages** — une ligne par sous-dossier, écran d'accueil en campagne.

⚠️ **Vocabulaire : dire « passage », jamais « écoute » ni « session ».** « une écoute » entre en collision avec « **point d'écoute** », qui désigne un lieu ; « session » est déjà surchargé dans l'app. « Passage » est le mot du protocole, celui qu'elle tape dans le préfixe, et il reste vrai quand une pose dure trois nuits. « Nuit » sert pour la date (« la nuit du 14/08 »), pas pour l'unité. « Mono-session / multi-sessions » restent des mots internes (`solo` / `campaign`) qui n'atteignent jamais un écran.

Cette liste porte les huit étapes de la chaîne — préfixé, découpé, fichiers zip créés, sauvegardé, archivé en ligne, déposé sur Vigie-Chiro, résultats reçus, « j'ai fini avec ce passage » — sous **deux modes de bascule** :

- **Mode avancement** : une vue d'ensemble de la campagne. Répond à « où en est le projet », d'un coup d'œil.
- **Mode à faire** : pour chaque passage, la prochaine action attendue. Répond à « qu'est-ce que je fais maintenant ».

⚠️ **« Pas encore fait » ne doit jamais être rouge.** Au premier lancement, un code rouge/jaune/vert produirait quatre-vingt-seize cases rouges pour un état parfaitement normal — elle n'a simplement rien fait encore. C'est le mur d'anxiété que [`vision.md`](./vision.md) interdit, et `ux.md` réserve le rouge aux **erreurs**. Le rouge n'est jamais un état d'avancement.

**Les trois dernières étapes sont déclarées, pas constatées** — « déposé » ne devient observable qu'en Phase 12, les deux autres jamais. Décision sur leur rendu :

- un `✓` **cyan** pour le déclaré, vert pour le constaté. `ux.md` réserve déjà le cyan à « valeur saisie par l'utilisatrice » : une étape déclarée en est une, aucune règle nouvelle ;
- chaque déclaration est **croisée avec ce que chiro observe** : « déposé » coché alors qu'aucun fichier zip n'a jamais été créé pour ce passage → avertissement jaune. C'est le seul endroit de la liste où une couleur d'alerte est méritée ;
- la dernière étape se dit **« J'ai fini avec ce passage »** — honnête quel que soit ce que la Phase 13 finira par recouvrir, et à la première personne comme toute étape déclarée.

**Granularité** : en campagne, la sauvegarde et l'archivage en ligne restent **par passage**, un fichier chacun — jamais un gros fichier de campagne. Un passage se restaure seul. C'est aligné de bout en bout : un sous-dossier, un passage, une participation, une sauvegarde. Et **la sauvegarde comme l'archivage en ligne refusent un dossier non préfixé** : sans préfixe commun, le nom de sauvegarde retombait sur `processed_YYYYMMDD.zip`, identique pour les douze passages d'une campagne, donc une seule clé en ligne — et l'écran « taille différente » aurait proposé de _remplacer_. Le cas « découpé mais jamais préfixé » n'existe pas sur le terrain ; on le refuse avec un message qui renvoie au préfixage, et le risque disparaît.

#### Découpage proposé — à valider en mode plan

Le périmètre complet est conservé (les trois relectures proposaient de le réduire ; décision : non). Il est en revanche **livré par morceaux**, chacun testable à la main et utile seul :

| Sous-phase | Livre                                                                                                                                                                                                                                                                                   | Utile même si on s'arrête là                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **11.A**   | `src/lib/campaign/` — l'état par dossier : les deux objets, le journal append-only, l'empreinte, le versionnement, la provenance constaté/déclaré **dans le type**. Chaque flux existant y inscrit son fait au succès.                                                                  | Oui — en mono aussi, et c'est le manifeste attendu par l'item 14                                    |
| **11.B**   | Les fichiers marqueurs et le constat à trois sorties (solo, campagne existante, campagne à créer), posés après `Entrée` seulement ; création des sous-dossiers vides avec leur `brut/` ; écran de configuration des douze préfixes côte à côte avec le repère PR, tout saisi à la main. | Oui — la relecture côte à côte a de la valeur avant tout suivi, et préparer une campagne vide aussi |
| **11.C**   | La liste des passages comme accueil de campagne, **mode avancement** : lecture de l'état, réconciliation contre le disque, affichage.                                                                                                                                                   | Oui — c'est le « fichier de suivi obligatoire »                                                     |
| **11.D**   | Le **mode à faire**, et les étapes déclarées avec leur rendu (cyan, croisement).                                                                                                                                                                                                        | Oui                                                                                                 |
| **11.E**   | La boucle : lancer un flux sur plusieurs passages, retour à la liste, sémantique d'abandon à deux niveaux.                                                                                                                                                                              | Oui — c'est le gain de temps                                                                        |
| **11.F**   | Docs : `spec.md`, `ux.md` (vocabulaire, conventions de la liste), `architecture.md` (ADR sur l'état), `CLAUDE.md` (pièges), `features/`.                                                                                                                                                | —                                                                                                   |

L'ordre A → E est celui des dépendances, pas des priorités : rien de C ne tient sans A, rien de E sans C.

#### Ce qui reste à trancher en mode plan

1. **Le détail du journal d'avancement.** Le principe est acquis — deux objets par passage, la config relue et un journal append-only jamais réécrit — parce que c'est la première structure **mutable** du projet et que deux instances de chiro faisant chacune un lire-modifier-écrire finiraient par un `rename` où le dernier gagne et efface l'étape de l'autre, sans trace. Reste à fixer : la forme d'une ligne, le numéro de version initial, et ce qu'on fait d'une ligne illisible (l'ignorer et le dire, jamais réécrire le fichier).
2. **Un registre central « comme cache » au-dessus des fichiers — laissé ouvert.** Fichier par dossier est acquis ; la question d'un registre agrégé reste posée pour plus tard. Ce qu'il faudra peser alors : un cache ne vaut que si le miss coûte cher (ici douze fichiers se lisent en quelques millisecondes), et tout fait stocké à deux endroits est un vert périmé en puissance.
3. **Les étapes déclarées et le suivi qui ment.** Le rendu est décidé (cyan, croisement avec l'observé). Reste la mécanique : où se coche une étape, comment on la décoche, et ce que chiro fait d'une déclaration contredite par le disque — signaler, jamais décocher tout seul.
4. **La hauteur.** Avec la largeur adaptative du chantier transverse, une liste de douze passages tient. Reste à définir le comportement quand elle ne tient pas — fenêtre réduite, ou campagne de trente passages : le défilement existe alors, avec sa convention à figer dans `ux.md` (indicateur haut/bas, comportement en butée, interaction avec le footer). `ResultScreen.tsx` tronque déjà à 3 par groupe pour la même raison, avec son motif en commentaire.
5. **Comment le multi s'appuie sur les flux existants.** Aujourd'hui « Découper » agit sur le `cwd` ; en campagne il agit sur une sélection. Réécrire les écrans de constat serait un refactor de tout l'existant. **Piste privilégiée : une boucle qui exécute N fois le flux inchangé**, un dossier à la fois. Mais elle sous-estime le travail : chaque flux est une séquence d'écrans **interactifs** (Constat → Form → Confirm → Result), donc douze passages = trente-six validations manuelles sans un mode non-interactif par itération ; les retours sont câblés en dur vers le menu (`app.tsx` n'a pas de pile de navigation) ; le `runningRef` global repasse à `false` entre deux itérations, et un Ctrl+C dans cette fenêtre tue la campagne entière au lieu du passage courant. C'est le poste principal de la 11.E, pas son détail.

### Phase 12 — Dépôt et récupération via l'API Vigie-Chiro

**Objectif** : supprimer les saisies manuelles du dépôt, et les erreurs qu'elles rendent possibles.

Ce n'est pas le temps de transfert qui coûte — déposer les volumes d'un passage n'est pas si long. Ce qui coûte, c'est **la chaîne d'opérations manuelles autour**, et le fait qu'elle se répète à l'identique pour chacun des douze passages : renseigner correctement le point d'écoute et le passage sur le portail, attendre les résultats de Vigie-Chiro, les post-traiter. Chaque saisie est une occasion de se tromper, et **une erreur rattache des enregistrements au mauvais point ou au mauvais passage** — une donnée scientifique fausse, qui ne se signale pas.

L'argument décisif est là : chiro **connaît déjà** le carré, l'année, le passage et le point. L'utilisatrice les a saisis une fois, à l'étape Préfixer, et ils sont dans le nom de chaque fichier. Les re-taper dans un formulaire web, c'est réintroduire à la main une information que le programme détient — et ouvrir la seule porte par laquelle une divergence peut apparaître entre le nom des fichiers et les métadonnées de la participation.

Le portail expose une API (backend Eve/Flask, [Scille/vigiechiro-api](https://github.com/Scille/vigiechiro-api)) qui permet de créer la participation, d'uploader les WAV et de déclencher l'analyse Tadarida depuis un programme.

Faisabilité **démontrée** par [ChiroTool](https://github.com/kevin-guille/ChiroTool), qui le fait en production chez plusieurs utilisateurs.

**Périmètre : déposer et récupérer.** Créer la participation, envoyer, déclencher l'analyse, savoir où elle en est, et rapatrier le fichier de résultats quand elle est finie. Ce qu'on en fait ensuite est la Phase 13. Ce que chiro ne fera pas : gérer les sites, les participations passées ou les identifications — seulement déposer ce qu'il vient de préparer.

**Et la conclusion logique de « sans re-saisie » : préparer un passage depuis Vigie-Chiro.** Si l'API le permet, l'utilisatrice choisit le point et le passage **dans une liste venue du portail**, et chiro **crée** le dossier de passage déjà configuré, avec son `brut/` prêt à recevoir la carte SD — ou **rattache** un dossier existant à une participation. Le préfixe n'est alors plus ni saisi ni déduit des fichiers : il vient de la source de vérité. C'est l'élimination de la classe d'erreur entière, pas sa réduction. Les deux gestes sont nécessaires, parce que la carte SD arrive souvent avant qu'on ait pensé à ouvrir chiro : rattacher restera le cas courant. Tout ceci dépend du mur du token (12.A) — c'est la mesure 11.0 qui dira si cette vision est atteignable.

Découpage sur le modèle de la Phase 10 — dont la sous-phase de mesure a invalidé deux affirmations du plan avant la première ligne de `src/`, et c'est exactement pour ça qu'elle passe en premier.

#### 12.0 — Mesure, avant toute ligne de `src/`

Contre l'API réelle, sur un compte de test :

- authentification (HTTP Basic, token en username, mot de passe vide) ;
- création d'une participation, upload d'un WAV (voie simple **et** multipart S3), `trigger_compute`, polling de l'état ;
- comportement sur les cas dégradés : token expiré, coupure en cours d'upload, **participation déjà existante** — ce dernier cas pilote la conception plus qu'il ne la teste : l'identifiant de participation doit être écrit dans l'état du passage **avant** le premier fichier envoyé, pour qu'une coupure reprenne dans la même participation au lieu d'en créer une seconde.

Le grain de participation et l'obtention du token ont déjà été mesurés en 11.0 ; cette sous-phase en hérite.

Traces réelles committées dans `test-data/`, comme `test-data/rclone-stats/`, avec un README des invariants observés.

**Accélérateur** : `vigiechiro_api.py` de ChiroTool est sous licence MIT et documente l'API mieux que sa documentation officielle — sérialisation RFC 1123 forcée en anglais (sinon Eve refuse les dates sous une locale française), ETag obligatoire sur les PUT, pagination Eve, politique de retry séparée avant-plan/arrière-plan. **À lire comme référence, avec attribution. Pas à copier.**

#### 12.A — Le mur du token

**Risque produit n° 1 du chantier, à trancher avant d'écrire un écran.** Le token s'obtient aujourd'hui en ouvrant les outils développeur du navigateur et en lisant `auth-session-token` dans le `localStorage`. Pour notre utilisatrice, c'est infranchissable seule — et si on n'a pas de réponse acceptable, la Phase 12 ne vaut pas mieux que le dépôt manuel qu'elle remplace.

Pistes à explorer et à arbitrer : configuration faite une fois par un tiers ; assistant guidé avec capture d'écran ; stockage dans le trousseau macOS.

#### 12.B → 12.E

Aligné sur le découpage 10.A1 / 10.A2 / 10.B / 10.C : logique pure d'abord, puis ce qui parle au réseau, puis les écrans, puis les docs.

#### Le flux zip reste, définitivement

Même si le dépôt par l'API aboutit, « Créer les zips à déposer » **reste une entrée de menu de plein droit**, jamais masquée derrière « l'API est disponible ». Le jour où le portail change son API, elle garde la capacité de déposer tout court. C'est exactement une capacité optionnelle au sens de `architecture.md` : le repli existe toujours, testé, visible. Le flux « Sauvegarder » et l'archivage Glacier restent aussi, pour un autre besoin — retrouver une étude trois ans plus tard.

### Phase 13 — Post-traiter les résultats

**Objectif à définir.** Ce que « post-traiter » recouvre exactement — nettoyage par seuil de probabilité, vérification des identifications, synthèse par espèce, mise en forme pour un rendu — sera arbitré avec l'utilisatrice au moment d'attaquer la phase, pas maintenant.

Deux choses sont sûres dès aujourd'hui, et méritent d'être écrites avant que la question se pose :

- **C'est le premier chantier de chiro dont le cœur est destructif** si le nettoyage par seuil en fait partie : supprimer des enregistrements sur la foi d'une probabilité d'identification. ⚠️ **Ne pas croire que les garde-fous de l'item 14 suffiront** : les deux destructions n'ont pas le même profil. L'item 14 supprime `processed/` alors que son contenu est **prouvé présent** dans un zip vérifié — ce qui disparaît est démontrablement récupérable. Ici, rien ne prouverait que les enregistrements supprimés existent ailleurs, et un garde-fou de _ratio_ n'y protège de rien : effacer 30 % des fichiers sur un mauvais seuil passe le ratio et perd les données. Le garde-fou qui manque est structurel — **refuser tant qu'une sauvegarde vérifiée du dossier n'existe pas** — et il reste entièrement à concevoir.
- **C'est la borne à ne pas franchir de [`vision.md`](./vision.md)** : chiro n'est pas un outil d'analyse acoustique. Trier des résultats produits par Tadarida n'est pas les produire — mais la frontière est plus fine ici que partout ailleurs, et c'est là que ChiroTool a construit la moitié de son périmètre.

## 3. Backlog

Estimations conservées depuis leur évaluation initiale.

### Confort d'usage

| #   | Item                                                                                                                                                                                                                                                                                                                                                       | Estim. |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | **Pré-remplissage de la dernière session** (`~/.chiro/last-session.json`). Gain UX majeur passage après passage. ⚠️ À repeser après la Phase 11 : la configuration par sous-dossier couvre déjà ce besoin en campagne ; l'item ne garde son intérêt que pour le mono.                                                                                      | 2 h    |
| 2   | **Annuler la dernière opération** (journal `.chiro-undo.json` posé au moment du rename). Rassurance maximale.                                                                                                                                                                                                                                              | 4 h    |
| 3   | **Écran « Vérifier un dossier »** — verdict PASS / PARTIAL / FAIL par invariant, lançable après coup sur un dossier douteux. ⚠️ Choisir les invariants pour attraper le cas _silencieux_ : celui de ChiroTool retourne PASS sur une perte de fichier réelle, parce qu'il vérifie « chaque source a au moins un segment » au lieu de « tous ses segments ». | 1 j    |
| 4   | **Auto-détection de l'enregistreur** depuis le header (`fmt.sampleRate` : 38 400 → `preserve`, > 100 000 → `expand-10x`). Évite l'écran de saisie du flux Découper.                                                                                                                                                                                        | 2 h    |
| 5   | **Lecture des métadonnées WAV** pour suggérer l'année et alerter en cas d'incohérence.                                                                                                                                                                                                                                                                     | 1 j    |
| 6   | **Mode batch CLI** : `chiro vigie --carre 040962 --pass 3 --point A1`.                                                                                                                                                                                                                                                                                     | 0,5 j  |
| 7   | **Linux arm64 / macOS Intel x64** — conditionnel : seulement si un collègue en a besoin.                                                                                                                                                                                                                                                                   | 1 h    |

### Découpage

| #   | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Estim.        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 8   | **Stabiliser l'ETA du découpage** — l'estimation oscille encore sensiblement. ⚠️ La fenêtre glissante **existe déjà** (`etaTracker.ts`, `SLIDING_WINDOW_SIZE = 50`) : inutile de la proposer. Deux causes réelles à traiter — la fenêtre compte 50 **fichiers**, pas 50 secondes (le fichier le dit lui-même : « _revisit if entry sizes ever become heterogeneous_ »), et `timeSinceLastMark` est ajouté à la durée de fenêtre à chaque appel, ce qui fait **gonfler l'ETA entre deux fichiers puis retomber d'un coup** — une oscillation par construction, indépendante de la fenêtre. | à évaluer     |
| 9   | **Streaming pour fichiers > 500 Mo** — `wavefile` charge tout en RAM ; parseur RIFF streaming (~150 lignes). À noter avant de s'y lancer : le plafond est appliqué dans `planBatch` **avant** le choix du moteur, donc un fichier de 800 Mo est écarté même quand `sox` est là et n'a aucune contrainte mémoire. Lever le plafond pour le seul chemin sox coûterait ~30 min — mais attention, le repli per-batch ferait alors exploser le worker pool sur ce fichier.                                                                                                                     | 1 j           |
| 10  | **Option split-channels** pour détecteurs stéréo (SM2BAT+, SM4BAT), alignée sur Kaleidoscope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 2 h           |
| 11  | **Durée de découpe paramétrable** — aujourd'hui 50 s output / 5 s réel, figé. Nécessaire pour un protocole autre que Point Fixe.                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 1 h           |
| 12  | **Modes TE additionnels** (×8, ×20) si un détecteur l'exige.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 30 min / mode |
| 13  | **Conservation du chunk `LIST/INFO`** (métadonnées AudioMoth), aujourd'hui droppé — cohérent avec Kaleidoscope. Seulement si Tadarida en a besoin.                                                                                                                                                                                                                                                                                                                                                                                                                                        | 4 h           |

### Archive

| #   | Item                                                                                                                                    | Estim. |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 14  | **Suppression de `processed/` après zip vérifié** — le vrai gain d'espace disque. Préconditions non négociables, détaillées ci-dessous. | 1,25 j |

**Préconditions de l'item 14** — aucune n'est optionnelle :

1. `verifyZipArchive` en `crcMode: "full"`, avec `AbortSignal` propagé et progression émise : en `full` sur 10–20 Go la vérification dure plusieurs minutes, pendant lesquelles la TUI serait figée et Ctrl+C inopérant.
2. ~~`fsync` du répertoire `archived/`~~ — **soldée en Phase 9**, remontée en `durable: boolean`. Le flux destructif devra exiger `durable === true`.
3. Écran de confirmation explicite, distinct du flux actuel : la réassurance « rien n'est supprimé » disparaît, tout le wording est à revoir.
4. Re-scanner `processed/` juste avant la suppression et ne supprimer que l'intersection avec ce qui a été archivé — `opts.entries` vient du scan de l'écran Constat, potentiellement plusieurs minutes plus tôt.
5. **Le critère d'identité de cette intersection est `(nom, taille, mtime)`, jamais le nom seul.** Un fichier réécrit entre le scan et la suppression porte le même nom, un contenu différent, et n'est pas dans le zip : une intersection par nom supprimerait la version neuve pour ne garder que l'ancienne dans l'archive, en silence. Tout ce qui ne correspond pas sur les trois champs est **conservé**. _(La liste nominative, elle, existe déjà : `ArchiveEntryStat` porte `name`, `size` et `mtime`, et `createZipArchive` prouve à la finalisation que l'archive contient exactement ce que l'appelant a demandé. La précondition n'a jamais été « retourner une liste » — elle était mal formulée.)_
6. **Garde-fou de ratio** : bloquer la suppression si elle dépasse un seuil du total, écrire les statistiques **avant** toute suppression, et ne pas marquer l'opération faite en cas de blocage. _(Repris du `cleanup.py` de ChiroTool, où le garde-fou est testé sur ses deux branches.)_

> La Phase 10 ne facilite **rien** de tout ça et ne doit pas être invoquée pour l'assouplir. « Le CRC intégral local est moins critique, on a une copie en ligne » est faux : la copie en ligne n'a jamais été vérifiée autrement que par sa **taille** (`verified: "size-match" | "unavailable"`, jamais un CRC). Elle ne prouve rien de plus que le zip local qu'elle duplique.

## 4. Écarté, et pourquoi

Consigné ici pour ne pas re-litiger.

- **Brew tap** et **internationalisation (EN)** — ne servent qu'à élargir l'audience. L'audience visée reste l'utilisatrice cible et son cercle proche.
- **Support Titley Anabat / Wildlife SM4** — malgré ChiroTool qui les gère et y gagne des utilisateurs. Même raison. À rouvrir si quelqu'un du cercle le demande (~3 h : un parseur de nom de plus).
- **`--self-test` étendu au zip ou à la série** — ni asset bundlé ni worker, donc aucun piège de `bun --compile` à couvrir. Ne pas le « compléter » par réflexe de symétrie.
- **`A-LIRE.txt` dans le dossier de série** (liste des fichiers + cases à cocher pour ne pas perdre le fil d'un dépôt multi-volumes) — à re-poser si le besoin se fait sentir. Devient sans objet dès la Phase 11, dont la liste des passages remplit le même rôle en mieux.
- **Upload API comme hors-scope définitif** — position tenue jusqu'ici par `vision.md`, abandonnée : la douleur du dépôt manuel est réelle et la faisabilité est démontrée. C'est devenu la Phase 12.
- **Déduire la configuration des passages depuis les fichiers** (Phase 11) — le numéro de série de l'enregistreur figure dans chaque nom de fichier, et les horodatages donnent l'ordre : de quoi pré-remplir presque tout. Écarté : **les noms de fichiers ne sont corrects que si l'utilisatrice ne s'est trompée dans aucune opération purement manuelle en amont** (la bonne carte SD dans le bon dossier, le bon enregistreur sur le bon point). Une déduction automatique donnerait à cette erreur-là l'apparence d'une configuration juste. Tout se saisit à la main ; l'outil aide la frappe, il ne devine pas.
- **Réduire la Phase 11** à un seul mode d'affichage, six étapes et pas de déclaration au-delà de « déposé » — proposé par les trois relectures. Écarté : le périmètre complet est voulu. Il est découpé en sous-phases livrables à la place.

## 5. Définition de « Terminé »

**Le MVP est livré**, et c'est ce qui rend cette section ambiguë : la chaîne complète tourne, elle a été validée en conditions réelles (§ 1), le `README.md` permet à un naturaliste non-tech de s'en servir sans intermédiaire — et pourtant trois chantiers suivent. Ce n'est pas une contradiction : le MVP tel qu'il avait été défini est atteint, mais l'usage réel a fait apparaître un besoin que la définition d'origine ne couvrait pas (§ 2).

D'où le problème du critère de succès de [`vision.md`](./vision.md) — **conjointe seule, < 2 min, sans peur**. Il souffre de deux défauts :

- il ne décrit **que le flux de préfixage**. Les autres flux livrés depuis n'ont jamais eu de critère à eux ;
- « moins de 2 minutes » n'a aucun sens pour un découpage d'une heure ou un archivage en ligne. Ce que ces flux doivent tenir est d'une autre nature : partir sans surveillance, et ne rien casser si on les interrompt.

Il devra donc être réécrit quand les Phases 11 à 13 auront fixé le périmètre — pas avant, pour ne pas viser une cible mouvante. En attendant, il reste valable pour ce qu'il décrit : le préfixage. Et ce qu'il faudra en garder, quelle que soit sa réécriture, c'est le « **sans peur** » : c'est le seul de ses trois termes qui vaille pour les huit étapes de la chaîne.
