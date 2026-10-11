# Evidence — Calcul des jours travaillés et du CA (réalisé + prévisionnel)

Rôle de ce fichier : ancrer la décision dans la réalité. Pas de solution ici, juste ce qu'on sait vraiment.

## Constat technique (code, vérifié le 2026-08-28)

- `workingDays()` ([main.js:1337](../../main.js#L1337)) compte uniquement les jours lundi-vendredi du calendrier entre deux dates. Aucune exclusion des jours fériés français, aucune notion de vacances, aucun plafond.
- Ce compte sert de base à `periodData()` pour tous les calculs de CA, marge et taux d'occupation (Gantt, Vue liste, Statistiques — KPI du haut, tableaux, graphiques).
- Le modèle de données (`consultants.json`, `prestations.json`, cf. README) ne contient **aucun champ** de plafond annuel de jours facturables. Le seul champ d'activité est `fte` (1 à 5), un taux d'activité constant, pas une limite annuelle.
- Statut des données au moment de cet écrit : à vérifier avec l'utilisateur si `data/` contient encore le jeu de démo (`seedDemo()`) ou déjà des données réelles — non consulté ici (règle projet : ne jamais lire `data/*.json` une fois rempli de vraies données).

## Verbatims (conversation du 2026-08-28)

> "les clients imposent un nombre de jour travaillé par an différent : comme 210, 216 ou 218 et que certains même n'ont pas de limite"

> "les gens partent en vacances, en France entre juillet et août mais tous en même temps, et pareil sur la dernière semaine de l'année"

## Hypothèses non vérifiées

1. Les KPI actuels (CA en négociation, taux d'occupation, prévision du trimestre suivant) sont **surestimés** en continu, puisque le calcul ne retranche ni fériés ni vacances.
2. Le biais s'aggrave spécifiquement en **juillet-août** et sur la **dernière semaine de décembre**, périodes de vacances groupées non reflétées dans `workingDays()`.
3. Sur une mission longue, un consultant approchant son **plafond annuel** (210/216/218 j) continue d'être compté à plein régime dans les projections, sans infléchissement de la courbe au moment où le plafond serait atteint.
4. Certains clients n'imposent **aucune limite** — donc un plafond, s'il est ajouté au modèle, doit être optionnel par prestation, pas une valeur globale unique.

## Ce qu'on ne sait pas encore

- Quelle est l'ampleur réelle de l'écart (en €, en jours) ? Pas mesurable tant que le projet tourne sur des données de démo.
- Est-ce que ce biais est actuellement gênant pour l'usage réel de l'outil (pilotage manager), ou seulement une imprécision théorique sans conséquence pratique à ce stade ?
- Y a-t-il une liste de référence pour les jours fériés français à maintenir (elle change chaque année) ?
- Est-ce que le plafond de jours est un plafond **par mission/client** (probable, vu le verbatim) ou une caractéristique du **contrat du consultant** (ex : régime forfait-jours, indépendant du client) ?

## Mise à jour du 2026-10-11 — absences individuelles ("non travaillé")

Nouvel angle, distinct du plafond annuel (Option 3, déjà décidée ci-dessous) : les congés/maladies d'un consultant précis ne sont pas modélisés du tout aujourd'hui, ce qui biaise aussi le CA (hypothèse 2 ci-dessus, jamais chiffrée).

### Constat technique (vérifié le 2026-10-11)

- Le seul mécanisme existant qui suspend un décompte est `activePause()` ([main.js:128](../../main.js#L128)), mais il porte sur `p.missionEvents` d'une **prestation** (pause côté client/mission), pas sur une personne. Il n'affecte que `prestationStatus()` (badge affiché) — **pas branché dans `periodData()`**, donc n'influence déjà pas le CA calculé aujourd'hui.
- Aucun champ d'absence n'existe sur `data/consultants.json`.

### Verbatims (conversation du 2026-10-11)

> "il ne faut pas entrer dans le détail de l'absence. on dit juste que ce sont des heures non travaillées. la raison c'est un autre sujet et ce n'est pas important ici."

> "manuellement, moi le manager, je vais saisir une période allant d'1/2 journée (matin ou après-midi) ou une période, et dire que la personne ne travaille pas sur ces dates. ce qui décompte le CA généré."

> "c'est différent d'une pause projet car cela vient d'une décision client. les 2 influencent le CA. Attention ça ne se cumule pas. une personne off, ou une pause, ce sont 2 situations qui peuvent arriver au même moment [...] c'est concomitant mais c'est tout."

### Hypothèses non vérifiées (nouvelles)

5. Granularité attendue : demi-journée (matin/après-midi) ou période de plusieurs jours — pas l'heure précise.
6. Aucune raison/type à stocker (pas de distinction congé/maladie/autre) — juste le fait "non travaillé" + la période.
7. Saisie manuelle uniquement, par le manager, sur la fiche de la personne (pas de source externe type SIRH).
8. Règle de non-cumul explicite : si une absence individuelle et une pause de mission (`missionEvents` type `pause`) tombent sur la même date, la perte de CA pour ce jour ne doit être comptée **qu'une seule fois**, pas deux.

## Mise à jour du 2026-10-11 (bis) — la nature de la prestation change la règle

### Constat technique (vérifié le 2026-10-11)

- `nature` existe déjà sur une prestation (`mission` | `forfait` | `projet_interne`, cf. README) mais **n'est utilisé que pour l'affichage** (badge/label) — jamais dans `periodData()` ([main.js:1450](../../main.js#L1450)). Le calcul du CA traite aujourd'hui toute prestation comme une mission (`currentTjm(p)*wDays*(p.fte||5)/5`), y compris les projets internes.
- Il n'existe aucun champ de "prix fixe" distinct pour un forfait — une prestation `forfait` a le même schéma (`tjm`, `fte`, `startDate`, `endDate`) qu'une mission (README).

### Verbatims (conversation du 2026-10-11)

> "1 forfait est différent d'une mission car le prix de l'ensemble de la prestation est convenu à l'avance. 1 forfait, prix fixe sur une durée pour une durée et un résultat et éventuellement une prolongation ou une sortie ou autre comme c'prévue."

> "1 mission c'est une personne vendue pour un temps à un prix convenu au début et qui éventuellement change."

> "un projet interne n'a pas de prix, c'est un investissement comme de la R&D. il n'influence pas le CA."

### Conséquence directe sur l'Option 4 (absences)

Une absence individuelle ne doit réduire le CA **que pour une mission**. Pour un forfait, le prix est fixé à l'avance pour la durée/le résultat — une absence ponctuelle ne le change pas. Pour un projet interne, il n'y a pas de CA à réduire (devrait déjà être à zéro, ce qui n'est pas le cas aujourd'hui — écart préexistant, indépendant des absences).

### Ce qu'on ne sait pas encore (nouveau)

9. Comment représenter le "prix fixe" d'un forfait sans nouveau champ : soit (a) on garde `tjm × jours ouvrés prévus sur la période` comme aujourd'hui, mais **sans** y appliquer la déduction des absences/pauses (le forfait reste insensible aux absences, pas de nouveau champ) ; soit (b) on ajoute un vrai champ de prix total forfaitaire, plus fidèle au métier mais plus de travail (nouveau champ, UI de saisie, README) et un changement de modèle plus large. Pas tranché.
