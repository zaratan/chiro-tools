# Archiver la sauvegarde en ligne

Envoie votre fichier de sauvegarde vers un stockage en ligne bon marché (Scaleway Glacier), pour le cas où le disque qui contient vos enregistrements tombe en panne.

**Fonction optionnelle.** Tant qu'elle n'est pas configurée, l'entrée n'apparaît pas dans le menu et chiro fonctionne exactement pareil.

## Ce que ça envoie

Uniquement le fichier de sauvegarde produit par [« Sauvegarder les enregistrements découpés »](./sauvegarder.md) — `archived/*.zip`. Jamais les fichiers zip de dépôt, jamais `processed/`.

S'il y a plusieurs sauvegardes dans `archived/`, chiro propose la plus récente et vous l'annonce.

Avant chaque envoi, chiro interroge le stockage pour savoir si le fichier y est déjà. Cette vérification se fait toujours à distance, jamais en relisant un journal local : un journal pourrait affirmer « déjà archivé » pour un fichier jamais parti, et c'est le pire échec possible pour une fonction de sauvegarde.

## Configuration — quatre étapes, une seule fois

### 1. Installer rclone

```bash
brew install rclone        # macOS
sudo apt install rclone    # Linux
```

### 2. Configurer le compte Scaleway

```bash
rclone config
```

Choisissez un nouveau remote, type de stockage **Scaleway**, puis collez la clé d'accès et la clé secrète. Elles se génèrent dans la console Scaleway, section **Identifiants API** (« IAM » → « Clés API »). Retenez le **nom du remote** que vous donnez ici, il sert à l'étape suivante.

### 3. Créer `~/.chiro/settings.json`

```json
{
  "coffre": {
    "remote": "chiro-coffre",
    "bucket": "mon-bucket-scaleway",
    "prefix": "vigie-chiro"
  }
}
```

`remote` est le nom donné à l'étape 2 — juste le nom, jamais `remote:bucket`. chiro ne lit jamais vos identifiants : ils restent dans la configuration de rclone (`~/.config/rclone/rclone.conf`).

### 4. Poser la règle de cycle de vie sur le bucket

Dans la console Scaleway (Object Storage → votre bucket → Règles de cycle de vie) : **« Abandonner les transferts multiparts incomplets »** (`AbortIncompleteMultipartUpload`) après **7 jours**.

⚠️ **Cette étape n'est pas facultative.** Sans elle, un envoi coupé par une panne de courant ou de réseau laisse des fragments **facturés** dans le bucket que rien ne vient jamais nettoyer. Ni chiro, ni vous.

Une fois ces réglages en place **et** rclone détecté, l'entrée « Archiver la sauvegarde en ligne » apparaît dans le menu. Tant que l'un des deux manque, elle reste invisible — chiro ne signale jamais une fonction à moitié configurée.

## Pendant le transfert

Comptez de l'ordre de 5 à 15 minutes pour une sauvegarde de 15 Go sur une bonne connexion — proportionnellement plus sur une connexion plus lente. chiro affiche la progression et continue tout seul ; il relance automatiquement les tentatives sur coupure réseau.

Sur macOS, chiro empêche l'ordinateur de s'endormir pendant le transfert — **mais uniquement s'il est branché sur secteur**. C'est une limite du système, pas de chiro : sur batterie, la mise en veille interrompra le transfert. L'écran de confirmation vous le rappelle si vous êtes sur batterie.

**Ctrl+C** interrompt proprement : chiro demande d'abord poliment à rclone de s'arrêter, et n'insiste qu'après plusieurs secondes. C'est ce délai qui permet à rclone d'abandonner les fragments en cours — sans lui, ils resteraient dans le bucket, facturés.

## Ce que ça ne fait pas

- **Il n'y a pas de reprise.** Un transfert interrompu recommence de zéro à la tentative suivante. rclone ne sait pas reprendre un envoi multipart entamé.
- **Le fichier arrivé n'est vérifié que par sa taille**, jamais par son contenu. Une copie en ligne de la bonne taille n'est donc **pas** une preuve que le contenu est intact — elle ne vaut pas plus que le fichier local qu'elle duplique. Ne considérez pas l'archivage en ligne comme une validation de votre sauvegarde.
- **Ça ne récupère pas vos fichiers.** La restauration est un geste manuel, décrit ci-dessous. C'est assumé : elle se fait une fois tous les quelques années.
- **Ça n'archive pas les fichiers zip de dépôt**, ni `processed/`.

## Une exception à connaître

Si un fichier du même nom existe déjà en ligne **avec une taille différente**, chiro vous propose de le **remplacer**. L'ancien est définitivement perdu — il n'y a pas de versionnage sur le bucket.

C'est le seul endroit de chiro où quelque chose est écrasé. C'est défendable parce qu'un transfert interrompu ne laisse jamais de fichier visible : un fichier présent avec une taille différente est forcément une version antérieure complète, jamais un envoi tronqué. Mais c'est une suppression, et elle vous est présentée comme telle.

## Récupérer une archive

Une fois en ligne, le fichier passe en classe **Glacier** : il n'est plus consultable directement. Il faut demander sa **restauration**, qui prend **24 à 48 heures**, puis le rapatrier.

```bash
# 1. Demander la restauration (remote / bucket / préfixe = ceux de settings.json)
rclone backend restore <remote>:<bucket>/<prefix>/<nom-du-zip> -o lifetime=7

# 2. Vérifier l'état (à refaire 24 à 48 heures plus tard)
rclone backend restore-status <remote>:<bucket>/<prefix>/<nom-du-zip>

# 3. Une fois restauré, rapatrier le fichier
rclone copy <remote>:<bucket>/<prefix>/<nom-du-zip> .
```

`lifetime=7` garde le fichier consultable 7 jours avant qu'il ne reparte automatiquement en Glacier.

**Coût** : environ 0,009 €/Go restauré — une sauvegarde de 15 Go coûte environ 0,14 € à récupérer. Le stockage lui-même est de l'ordre de quelques centimes par mois pour la même taille.

## Ce qui a été vérifié

Un archivage réel a été effectué : un fichier de sauvegarde envoyé, relu en classe `GLACIER`, et facturé (à hauteur de quelques centimes). Le comportement à l'interruption a également été vérifié à la main — après un Ctrl+C en plein transfert, aucun fragment ne reste dans le bucket.
