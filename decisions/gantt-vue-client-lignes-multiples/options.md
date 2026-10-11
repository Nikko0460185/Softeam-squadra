# Options — Lignes multiples par client dans le Gantt (vue client)

Rôle de ce fichier : structurer la décision. A-t-on vraiment pesé les alternatives ? Voir [evidence.md](evidence.md) pour ce qu'on sait du problème.

## Option 0 — Ne rien changer

Garder le comportement actuel : `stackBars()` empile les prestations qui se chevauchent en sous-lignes distinctes à l'intérieur du bloc client, sans toucher au code.

- **Pour** : cohérent avec la Vue liste client (déjà validée par l'utilisateur comme "parfaite", à ne pas toucher), qui affiche elle aussi 2 lignes pour ces mêmes 2 enregistrements `prestations`. Conserve l'information "quel consultant est staffé à quelle période exacte".
- **Contre** : aucun identifié — c'est la même logique que la Vue liste (2 enregistrements = 2 lignes), pas une incohérence propre au Gantt.

## Option 1 — Fusionner visuellement en une seule barre par client + service

Regrouper les prestations partageant le même `client` + `clientService` en une seule barre dans le Gantt vue client (couvrant l'union des dates), au lieu de sous-lignes empilées.

- **Pour** : plus compact visuellement si plusieurs consultants sont staffés sur une même mission.
- **Contre** : perd l'info "quel consultant est staffé à quelle période exacte" (utile si Antoine et Thomas n'ont pas exactement les mêmes dates de début/fin) ; introduirait une incohérence avec la Vue liste, qui elle garde 2 lignes distinctes — casserait la correspondance "1 ligne Vue liste ↔ 1 bar Gantt" déjà en place pour toutes les autres prestations.

## Décision retenue

**Option 0**, décidé le 2026-10-11 — aucun changement de code. Le comportement actuel du Gantt reflète fidèlement le modèle de données (une prestation = un consultant) et reste cohérent avec la Vue liste, déjà validée pour ce même cas.
