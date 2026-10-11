# Outcome — Lignes multiples par client dans le Gantt (vue client)

Rôle de ce fichier : ce qui a été livré, une fois la décision passée à l'exécution. Voir [evidence.md](evidence.md) et [options.md](options.md) pour le constat et les alternatives pesées.

## Ce qui a été fait

Rien côté code. L'Option 0 retenue ("ne rien changer") se confond ici avec son exécution : il n'y avait pas de correctif à construire, juste à confirmer que le comportement actuel était la bonne logique.

## Vérification

- Relecture du code confirmée le 2026-10-11 : `ganttRowsData()` ([main.js:702-721](../../main.js#L702-L721)) et `stackBars()` ([main.js:665](../../main.js#L665)) n'ont pas été modifiés.
- Comportement inchangé en Vue liste (`renderListClients()`, [main.js:933](../../main.js#L933)) — conforme à la demande explicite de l'utilisateur de ne pas y toucher.

## Trace

Backlog mis à jour (`BACKLOG.md`, section Fait) le 2026-10-11 avec un renvoi vers ce dossier.
