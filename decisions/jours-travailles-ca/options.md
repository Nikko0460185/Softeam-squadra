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

**Option 4**, absences individuelles ("non travaillé") sur la fiche consultant, en remplacement de l'Option 2. Décidé le 2026-10-11.

## Comparaison rapide

| Option | Effort | Résout fériés | Résout vacances | Résout plafond | Risque |
|---|---|---|---|---|---|
| 0 — Rien | Nul | Non | Non | Non | Aucun (biais silencieux) |
| 1 — Fériés | Faible | Oui | Non | Non | Faible |
| 2 — Abattement forfaitaire (abandonnée, remplacée par 4) | Faible/Moyen | Non | Approximatif | Non | Moyen (règle arbitraire) |
| 3 — Limite d'UO (opportunité+prestation) | Moyen/Élevé | Non | Non | Oui | Moyen (transversal, question métier ouverte) |
| 4 — Absences individuelles par consultant | Moyen | Non | Oui (précis, pas approximatif) | Non | Moyen (saisie manuelle récurrente, règle de non-cumul à bien implémenter) |

Ces options ne sont pas exclusives entre elles (1+3, ou 3+4, sont combinables) — 1 (fériés) reste non choisie à ce stade.

## Option 4 — Absences individuelles ("non travaillé") sur la fiche consultant

Ajoutée le 2026-10-11, en remplacement de l'Option 2 (abattement forfaitaire collectif) pour qui veut une précision par personne. Voir evidence.md, section "Mise à jour du 2026-10-11".

Ajouter sur `data/consultants.json` une liste de périodes "non travaillé" par consultant : demi-journée (matin/après-midi) ou plage de dates, sans type/raison (congé, maladie ou autre — non distingué, hors sujet ici). Saisie manuelle par le manager sur la fiche de la personne. Ces périodes retranchent des jours comptés dans `periodData()` pour ce consultant, au même titre qu'une pause de mission (`activePause()`) — avec une règle de non-cumul : une date couverte par les deux (absence individuelle **et** pause de mission concomitantes) ne doit perdre son CA qu'une fois, pas deux.

- **Pour** : précision réelle (contrairement à l'Option 2, abandonnée) sans entrer dans une gestion RH complète (pas de type, pas de workflow de demande/validation) — reste au niveau "déclaratif manager", cohérent avec le reste de l'outil (pas de système d'authentification/rôles multiples).
- **Contre** : saisie manuelle récurrente pour le manager (pas de source automatique) ; nécessite de définir précisément la règle de non-cumul dans `periodData()` (où se place la vérification : au niveau du jour, avant d'appliquer la pause de mission puis l'absence individuelle, sans compter le jour deux fois) ; distinct du plafond annuel (Option 3, déjà décidé) — les deux sujets restent complémentaires, pas redondants.
- **Statut** : retenue, décidée le 2026-10-11 — reste à implémenter (champ `data/consultants.json`, UI de saisie sur la fiche consultant, branchement dans `periodData()` avec la règle de non-cumul).

## Option 5 — Rendre `periodData()` sensible à la nature (mission / forfait / projet interne)

Ajoutée le 2026-10-11, prérequis pour que l'Option 4 soit correcte — voir evidence.md, section "la nature de la prestation change la règle".

Dans `periodData()`, traiter différemment les 3 natures au lieu de toutes les compter comme une mission :
- **Mission** : CA = `tjm × jours réellement travaillés × fte/5` — jours réellement travaillés = jours ouvrés **moins** pauses de mission **moins** absences individuelles (non cumulées, cf. Option 4).
- **Forfait** : prix fixé à l'avance, **jamais réduit** par une absence ponctuelle ou une pause.
- **Projet interne** : CA = 0, toujours (c'est un investissement, pas une vente).

Deux sous-choix pour représenter le prix du forfait (pas tranché) :
- **(a) Sans nouveau champ** — garder `tjm × jours ouvrés prévus sur la période` comme aujourd'hui, mais ne jamais y appliquer la déduction des absences/pauses. Effort faible (une condition `if (nature==='forfait') skip` dans le calcul), mais le CA d'un forfait reste calculé par un TJM × durée, pas un vrai "prix convenu" explicite — simple approximation qui donne le même résultat en pratique si rien ne change en cours de route.
- **(b) Nouveau champ de prix forfaitaire** — ajouter un champ (ex : `prixForfait`) saisi une fois à la création, qui devient directement le CA de la période couverte (répété par mois dans l'affichage, ou en bloc selon une proratisation simple). Plus fidèle au métier réel, mais plus de travail : nouveau champ sur `prestations.json`, UI de saisie dans la modale, mise à jour du README, et une règle de proratisation à définir si le forfait s'étale sur plusieurs mois/trimestres affichés séparément.

- **Pour** : corrige un écart déjà présent (projets internes comptés dans le CA aujourd'hui) en même temps que ça rend l'Option 4 correcte (sans ça, une absence réduirait aussi le CA d'un forfait, ce qui serait faux).
- **Contre** : élargit la portée du chantier "absences" — Option 4 seule ne suffit plus, il faut les deux en même temps pour ne pas introduire une nouvelle erreur de calcul.
- **Statut** : retenue en principe (nécessaire pour l'Option 4), mais le sous-choix (a) vs (b) pour le forfait reste à trancher avant implémentation.
