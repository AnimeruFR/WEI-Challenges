# WEI Info · Défis

Site web pour réaliser les défis du WEI **en équipe** : chaque membre rejoint son équipe avec un code, et chaque contribution (+10 pompes, +0,5 L…) fait avancer les compteurs communs de l'équipe.

Pas de points : l'équipe a **3 jours** pour réussir tous les défis. Soit elle les réussit tous, soit elle a perdu.

## Fonctionnalités

- **Équipes** : création d'une équipe → un code d'invitation à 6 caractères à partager. Pas de mot de passe, juste un pseudo.
- **Défis communs** : chaque défi a un objectif (ex. 300 pompes). Tous les membres y contribuent, la progression est partagée.
- **Ajout rapide** : boutons +1 / +5 / +10… ou quantité libre, avec une note facultative.
- **Annulation** : chacun peut annuler ses propres contributions en cas d'erreur.
- **Activité** : fil des dernières contributions de l'équipe.
- **Compte à rebours** : temps restant et statut de l'équipe (en cours, réussi, perdu). Une fois le temps écoulé, plus aucun ajout n'est possible.
- Rafraîchissement automatique toutes les 10 s, mode sombre, adapté au mobile.

Pour retrouver son compte sur un autre appareil, il suffit de rejoindre l'équipe avec le même code et le même pseudo.

## Lancer le site

Node.js ≥ 18, **aucune dépendance** à installer.

```bash
npm start            # http://localhost:3000
PORT=8080 npm start  # autre port
```

Les données sont enregistrées dans `data/db.json` (modifiable via `DATA_DIR`). Pour tout remettre à zéro, arrêter le serveur et supprimer ce fichier.

## Régler la durée

Dans [`config.json`](config.json) :

```json
{ "deadline": "2026-10-04T18:00:00+02:00", "durationHours": 72 }
```

- `deadline` : date et heure de fin, commune à toutes les équipes (recommandé).
- Si `deadline` vaut `null`, chaque équipe a `durationHours` heures (72 h = 3 jours) à partir de sa création.

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
