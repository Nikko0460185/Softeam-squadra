# Evidence — Lignes multiples par client dans le Gantt (vue client)

Rôle de ce fichier : ancrer la décision dans la réalité. Pas de solution ici, juste ce qu'on sait vraiment.

## Contexte

Question posée le 2026-10-11 à propos de la prestation "Orange · pôle UX" (terminée), staffée par deux consultants (Antoine, Thomas).

## Constat technique (code, vérifié le 2026-10-11)

- Une "prestation" (`data/prestations.json`) est toujours rattachée à un seul `consultantId` — il n'existe aucune entité de mission multi-consultants dans le modèle de données.
- Une même mission client staffée par 2 consultants est donc forcément **2 enregistrements `prestations` distincts**, qui partagent juste `client`/`clientService`.
- Vue liste client (`renderListClients()`, [main.js:933](../../main.js#L933), items ligne ~962) : un item par prestation → 2 lignes dans le tableau de la carte client, chacune affichant le consultant en colonne variable.
- Gantt vue client (`ganttRowsData()`, [main.js:702-721](../../main.js#L702-L721)) : un seul bloc/ligne par client (le label "Orange" n'apparaît qu'une fois) ; `stackBars()` ([main.js:665](../../main.js#L665)) empile ensuite, à l'intérieur de ce bloc, les prestations qui se chevauchent dans le temps sur des sous-lignes distinctes.
- Les deux vues produisent donc le même résultat (2 lignes visibles) à partir de la même cause (2 enregistrements `prestations`), avec juste une présentation différente (tableau vs barres empilées sous un label commun).

## Verbatims (conversation du 2026-10-11)

> "il y a une prestation qui s'appelle Orange pole UX et qui est terminé. en vu consultant, dans le gantt elle s'affiche pour Antoine et Thomas, chacun dans sa ligne. mais dans le gannt en vu client, il y a 2 ligne. Or est ce qu'est bien la logique d'avoir 2 ligne si c'est la meme prestation du point de vu du client ?"

> "par contre en vu liste, c'est parfait dans les vu client et consultanat. il ne faut pas y touché."

## Ce qu'on ne sait pas encore

- Si Antoine et Thomas avaient des dates qui ne se chevauchent pas du tout, `stackBars()` les placerait sur une seule et même sous-ligne (empilement par recouvrement temporel, pas par identité) — non vérifié sur ce cas précis sans lire `data/prestations.json` (fichier privé, règle projet : jamais lu une fois rempli de vraies données).
