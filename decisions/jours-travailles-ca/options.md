# Options — Calcul des jours travaillés et du CA

Rôle de ce fichier : structurer la décision. A-t-on vraiment pesé les alternatives ? Voir [evidence.md](evidence.md) pour ce qu'on sait du problème.

## Option 0 — Ne rien construire

Laisser `workingDays()` tel quel (jours ouvrés bruts, sans fériés/vacances/plafond).

- **Pour** : zéro effort, zéro risque de régression sur les calculs existants (Statistiques dépend de `periodData()` partout). Tant que `data/` est en démo, l'écart n'a aucune conséquence réelle sur une décision de pilotage.
- **Contre** : le biais reste présent silencieusement ; si de vraies données arrivent avant qu'on y revienne, les KPI affichés seront faux sans avertissement.
- **Condition pour que ce soit le bon choix maintenant** : confirmer que `data/` est toujours en démo (evidence.md, inconnue non résolue).

## Option 1 — Exclure les jours fériés français

Ajouter une liste de jours fériés (fixes + mobiles type Pâques/Ascension) et les retrancher dans `workingDays()`.

- **Pour** : petit effort, correction ciblée et non ambiguë (les fériés sont un fait, pas une hypothèse à trancher).
- **Contre** : liste à maintenir chaque année (dates mobiles). Ne corrige ni le biais vacances d'été/fin d'année, ni le plafond annuel — traite le plus petit des trois écarts identifiés dans evidence.md.

## Option 2 — Abattement forfaitaire juillet-août + dernière semaine de décembre

Réduire `workingDays()` d'un pourcentage ou de dates fixes pendant ces périodes, sans modéliser qui est réellement absent.

- **Pour** : capture le biais le plus visible (creux saisonnier) sans avoir à suivre les congés individuels — cohérent avec le niveau de précision actuel de l'outil (pas de suivi de congés par consultant).
- **Contre** : un abattement forfaitaire est une approximation qui peut sur- ou sous-corriger selon le consultant réel ; introduit une règle "magique" (quel pourcentage ? quelles dates exactes ?) qu'il faudra justifier et qui reste une hypothèse tant qu'elle n'est pas confrontée à de vraies données de facturation.

## Option 3 — Limite d'UO (plafond de jours annuel) sur opportunité + prestation

Ajouter un champ optionnel (ex : `limiteUOAn`, 210/216/218/vide = illimité) sur `opportunites.json` **et** `prestations.json`, avec le même mécanisme de suivi que le TJM estimé aujourd'hui : saisi (ou non) sur l'opportunité, repris automatiquement sur la prestation quand une candidature est gagnée.

- **Pour** : répond directement au verbatim le plus concret ("les clients imposent 210, 216, 218 ou pas de limite") ; améliore le prévisionnel (dès le stade opportunité) et pas seulement le réalisé ; réutilise un mécanisme déjà existant et éprouvé (`tjm` estimé → repris à la conversion candidature gagnée → prestation, cf. README) plutôt que d'en inventer un nouveau.
- **Contre** : reste un effort réel — nouveau champ sur deux entités, UI de saisie (modales Opportunité et Prestation), logique de plafonnement dans `periodData()`/les projections trimestrielles/le Gantt. Ouvre une question non tranchée : que fait-on concrètement quand le plafond est atteint en cours d'année (le consultant s'arrête ? RTT ? l'app doit-elle juste avertir sans bloquer) ?
- **Non retenu à ce stade — fiche client (entité séparée)** : envisagée comme alternative pour centraliser ce plafond une seule fois par client, mais écartée car sans second paramètre concret à y loger aujourd'hui, ce serait construire pour un besoin hypothétique. Rare cas non couvert par ce choix : un même client avec plusieurs missions longues (>1 an) en parallèle chez des consultants différents devra voir la limite ressaisie sur chaque prestation — accepté comme risque mineur vu la fréquence attendue. À rouvrir comme décision séparée si un vrai deuxième paramètre client apparaît.

## Décision retenue

**Option 3**, scope réel = limite d'UO sur opportunité + prestation, suivi comme le TJM. Décidé le 2026-08-28.

## Comparaison rapide

| Option | Effort | Résout fériés | Résout vacances | Résout plafond | Risque |
|---|---|---|---|---|---|
| 0 — Rien | Nul | Non | Non | Non | Aucun (biais silencieux) |
| 1 — Fériés | Faible | Oui | Non | Non | Faible |
| 2 — Abattement forfaitaire | Faible/Moyen | Non | Approximatif | Non | Moyen (règle arbitraire) |
| 3 — Limite d'UO (opportunité+prestation) | Moyen/Élevé | Non | Non | Oui | Moyen (transversal, question métier ouverte) |

Ces options ne sont pas exclusives entre elles (1+2, ou 1+3, sont combinables) — mais aucune n'a encore été choisie.
