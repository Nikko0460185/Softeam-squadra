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
