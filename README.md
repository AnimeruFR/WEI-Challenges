# WEI Info · Défis

Site web pour réaliser les défis du WEI **en équipe** : chaque membre rejoint son équipe avec un code, et chaque contribution (+10 pompes, +0,5 L…) fait avancer les compteurs communs de l'équipe.

Pas de points : du **vendredi 2 octobre 19 h au dimanche 4 octobre 17 h**, l'équipe doit réussir tous les défis. Soit elle les réussit tous, soit elle a perdu.

## Fonctionnalités

- **Équipes** : création d'une équipe → un code d'invitation à 6 caractères à partager. Pas de mot de passe, juste un pseudo.
- **Défis communs** : chaque défi a un objectif (ex. 300 pompes). Tous les membres y contribuent, la progression est partagée.
- **Ajout rapide** : boutons +1 / +5 / +10… ou quantité libre, avec une note facultative.
- **Annulation** : chacun peut annuler ses propres contributions en cas d'erreur.
- **Preuves** : jusqu'à 4 photos ou captures d'écran par contribution, réduites et compressées sur le téléphone avant l'envoi. Toute l'équipe peut les voir et les agrandir.
- **Défis ajoutés par l'équipe** : bouton « + Ajouter un défi » sous la liste (nom, objectif, unité, précision, obligatoire ou bonus). Ces défis ne concernent que l'équipe qui les crée et peuvent être supprimés ; les défis communs de `challenges.json`, eux, ne le peuvent pas.
- **Activité** : fil des dernières contributions de l'équipe.
- **Compte à rebours** : avant le début, puis jusqu'à la fin, avec le statut de l'équipe (à venir, en cours, réussi, perdu).
- **Répartition des tâches** : sur chaque défi, « Je m'en charge » indique qui s'en occupe ; le filtre « Mes défis » n'affiche que les siens.
- Pensé pour le **téléphone** : grands boutons tactiles, prise en compte de l'encoche, mode sombre automatique.
- **Installable sur l'écran d'accueil** (Safari : Partager → « Sur l'écran d'accueil » ; Chrome : menu → « Ajouter à l'écran d'accueil ») : le site s'ouvre alors comme une appli.
- Rafraîchissement automatique toutes les 10 s.

Pour retrouver son compte sur un autre appareil, il suffit de rejoindre l'équipe avec le même code et le même pseudo.

## Lancer le site

Node.js ≥ 18, **aucune dépendance** à installer.

```bash
npm start            # http://localhost:3000
PORT=8080 npm start  # autre port
```

Les données sont enregistrées dans `data/db.json` et les images dans `data/uploads/` (dossier modifiable via `DATA_DIR`). Pour tout remettre à zéro, arrêter le serveur et supprimer le dossier `data/`.

## Régler les dates

Dans [`config.json`](config.json) :

```json
{
  "start": "2026-10-02T19:00:00+02:00",
  "end": "2026-10-04T17:00:00+02:00"
}
```

- **Avant `start`** : on peut déjà créer et rejoindre les équipes, consulter les défis, en ajouter et se répartir les tâches (« Je m'en charge »), mais pas encore ajouter d'avancement.
- **Entre `start` et `end`** : les membres ajoutent leurs avancements.
- **Après `end`** : tout est figé. L'équipe a réussi si tous les défis obligatoires sont terminés, sinon elle a perdu.

Sans `end`, chaque équipe a `durationHours` heures (72 par défaut) après sa création. Redémarrer le serveur après modification.

## Modifier les défis

Tout se trouve dans [`challenges.json`](challenges.json) :

```json
{ "id": "pompes", "title": "Pompes", "target": 300 }
{ "id": "alcool", "title": "Alcool", "target": 50, "unit": "L", "step": 0.5 }
{ "id": "minecraft", "title": "Minecraft moddé", "description": "Atteindre le goal.", "target": 1, "bonus": true }
```

| Champ         | Rôle                                                                 |
|---------------|----------------------------------------------------------------------|
| `id`          | Identifiant unique (ne pas le changer une fois le WEI commencé)      |
| `title`       | Nom affiché                                                          |
| `description` | Précision facultative                                                |
| `target`      | Objectif à atteindre (1 pour un défi « à faire une fois »)          |
| `unit`        | Unité facultative (ex. `L`)                                          |
| `step`        | Plus petite quantité ajoutable (défaut 1, ex. `0.5`)                 |
| `bonus`       | `true` : défi facultatif, pas nécessaire pour réussir                |

Redémarrer le serveur après modification.
