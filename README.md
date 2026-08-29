# SQUADRA — Pilotage & Staffing

SQUADRA est l'outil interne de pilotage des consultants Softeam. Il centralise le suivi des missions, des TJM et des indicateurs financiers — une donnée qui manquait jusqu'ici et qui était éparpillée sans vue unifiée.

**Deux niveaux d'accès prévus :**
- **Manager** — vue globale de toute l'équipe, statistiques consolidées, suivi du pipeline
- **Consultant** — accès à son propre profil et ses prestations uniquement

Vocation : être déployé à terme à l'échelle de tout Softeam.

## Fonctionnalités

- **Timeline Gantt** — visualisation des missions sur une fenêtre de 36 mois (1 an dans le passé, 2 ans dans le futur), navigable dans le temps (boutons, flèches clavier, défilement horizontal)
- **Vue liste** et **Gantt** partagent une bascule **Consultants ⇆ Clients** : regrouper l'affichage par consultant ou par client
- **Pipeline Opportunité** — suivi du besoin client avant qu'il ne devienne une mission : une opportunité peut avoir plusieurs candidatures en parallèle (un consultant par candidature), chacune avec son journal de pushs de book/CV et de soutenances. Une candidature gagnée devient automatiquement une prestation (client, dates, nature et TJM estimé repris s'ils étaient renseignés). Les opportunités encore ouvertes, avec des dates prévisionnelles, apparaissent aussi dans le Gantt sous forme de barre "pipeline" distincte des missions confirmées, et dans le graphique "CA en négociation" des Statistiques si un TJM estimé est renseigné.
- Filtres combinables par **statut** (En cours/En attente/Gagnées/Perdues, vocabulaire commun aux prestations et aux opportunités) et par **type** (Prestations/Opportunités)
- **Statistiques** — CA (confirmé et en négociation), taux d'occupation, marge, suivi financier
- Le statut d'une prestation (En cours/Terminée) n'est jamais saisi à la main : calculé automatiquement à partir des dates, pour ne jamais rester désynchronisé de la réalité
- Suivi des entrées et sorties de consultants, avec badge visuel ("Arrive le…" / "Sortie le…") dans la sidebar et le Gantt tant que la date n'est pas passée
- Gestion des prolongations et sorties anticipées (sur les prestations)
- Suivi des révisions de TJM et du coût complet
- Données persistées localement, dans des fichiers JSON séparés de l'outil

## Lancer le projet

Prérequis : [Node.js](https://nodejs.org) installé, aucune autre dépendance. Première installation sur un nouvel ordinateur ? Voir [INSTALLATION.md](INSTALLATION.md).

```bash
node server.js
```

Puis ouvrir [http://localhost:3000](http://localhost:3000) dans un navigateur.

## Structure

```
├── index.html           # Structure HTML
├── main.js              # Logique applicative
├── server.js            # Serveur local (sert l'app + lit/écrit data/)
├── package.json
├── data/                 # Données locales (ignoré par Git, voir ci-dessous)
│   ├── consultants.json
│   ├── prestations.json
│   ├── opportunites.json
│   └── candidatures.json
└── styles/
    ├── main.css         # Référence de l'ordre des fichiers (non chargé — index.html a un <link> par fichier)
    ├── tokens.css       # Variables de design (couleurs, radius…)
    ├── layout.css       # Structure générale
    ├── utilities.css    # Toast, états vides, scrollbar
    ├── atoms/           # Boutons, formulaires, badges, avatar
    ├── molecules/       # Nav, cards, groupes de formulaires
    └── organisms/       # Sidebar, topbar, modales, vues
```

## Données

Les données sont séparées de l'outil : elles vivent dans des fichiers JSON locaux, lus et écrits par `server.js`.

Ce dossier `data/` n'est **pas** suivi par Git (voir `.gitignore`) : seul l'outil est versionné. Au premier lancement, si `data/` est vide, un jeu de données de démonstration est généré automatiquement.

Le JSON ne supporte pas les commentaires : la documentation des champs vit ici plutôt que dans les fichiers eux-mêmes.

### `data/consultants.json`

Tableau de collaborateurs.

| Champ | Type | Description |
|---|---|---|
| `id` | string | Identifiant unique généré à la création, sert de clé de référence (ex: dans `consultantId` côté prestations). |
| `name` | string | Prénom et nom. |
| `role` | string | Intitulé de poste / expertise (ex: "Lead Développeuse"). |
| `dateEntree` | string (`YYYY-MM-DD`) | Date d'entrée dans l'entreprise. Obligatoire — sert à ne compter le consultant dans les stats (effectif, masse salariale) qu'à partir de ce mois-là. |
| `dateSortie` | string (`YYYY-MM-DD`) | Date de sortie de l'entreprise (optionnel, vide si toujours en poste). Le consultant sort des stats après ce mois-là. |
| `coutComplet` | number | Coût employeur complet de base, en €/jour travaillé (optionnel). Donnée interne, sert au calcul de marge. |
| `coutCompletRevisions` | array de `{ date, coutComplet }` | Historique des révisions du coût complet (optionnel) : à partir de chaque `date`, le nouveau `coutComplet` s'applique. La saisie peut se faire avant ou après la date d'effet. Chaque section de l'app (Gantt, Statistiques — masse salariale, tarif cible, marge) utilise la valeur applicable à la période qu'elle affiche, pas systématiquement la valeur du jour. |

Tant que `dateEntree` est dans le futur, un badge "Arrive le…" s'affiche à côté du consultant (sidebar + Gantt). Si `dateSortie` est renseignée, un badge "Sortie le…" (ou "Sorti(e) le…" une fois la date passée) s'affiche de la même façon.

### `data/prestations.json`

Tableau de missions/prestations, chacune rattachée à un consultant.

| Champ | Type | Description |
|---|---|---|
| `id` | string | Identifiant unique généré à la création. |
| `consultantId` | string | Référence vers `id` dans `consultants.json`. |
| `client` | string | Nom du client final. |
| `clientService` | string | Service/pôle chez le client (optionnel). |
| `nature` | string | `mission` (régie), `forfait` ou `projet_interne`. |
| `titre` | string | Intitulé du profil/poste occupé sur cette mission (optionnel). Repris automatiquement de l'opportunité d'origine si une candidature est gagnée, comme le TJM estimé. |
| `startDate` | string (`YYYY-MM-DD`) | Date de début de la prestation. |
| `endDate` | string (`YYYY-MM-DD`) | Date de fin prévue initialement. |
| `missionEvents` | array de `{ id, type, date, resumeDate? }` | Historique des modifications de la mission : `type` = `prolongation` (nouvelle date de fin, `date` > `endDate`), `pause` (mission arrêtée temporairement, `resumeDate` optionnelle si la reprise n'est pas encore connue) ou `sortie_anticipee` (`date` < `endDate`). Plusieurs entrées possibles dans le temps (ex : prolongée une 1re fois, puis une 2e) — la plus récente entrée `prolongation`/`sortie_anticipee` fait foi pour la fin effective (`effectiveEnd()`) ; une `pause` n'affecte pas la fin, seulement le statut (`en_pause`) pendant sa fenêtre. **Le Gantt et le statut lisent cet historique ; les Statistiques (CA, occupation) ne l'utilisent pas encore et continuent de considérer une prestation en pause comme normalement active.** |
| `tjm` | number | TJM (taux journalier moyen) initial, en €/jour. |
| `fte` | number | Taux d'activité, de 1 à 5 (5 = temps plein, ex: 4 = 4 jours/5). |
| `tjmRevisions` | array de `{ date, tjm?, fte? }` | Historique des révisions de TJM et/ou taux d'activité : à chaque `date`, le(s) champ(s) renseigné(s) (`tjm` et/ou `fte` — au moins un des deux) s'applique(nt) à partir de cette date. **Le TJM est utilisé partout dans les calculs (`currentTjm()`) ; le taux d'activité révisé n'est affiché que dans la modale Prestation elle-même — le Gantt et les Statistiques continuent de lire `fte` à plat sur la prestation, pas l'historique.** |
| `notes` | string | Notes libres (contacts, informations utiles). |
| `opportuniteId` | string | Référence vers `id` dans `opportunites.json` (optionnel) : renseigné automatiquement quand la prestation naît d'une candidature gagnée, pour retrouver l'opportunité d'origine depuis la prestation. |
| `limiteUOAn` | number | Limite d'unités d'œuvre (jours) par an imposée par le client (optionnel, ex : 210/216/218 — vide si le client n'impose pas de limite). Repris automatiquement de l'opportunité d'origine si une candidature est gagnée, comme le TJM estimé. Non encore utilisé dans les calculs de CA/Statistiques — voir [decisions/jours-travailles-ca/](decisions/jours-travailles-ca/). |

Pas de champ `status` : une prestation est toujours "En cours", "En pause" ou "Terminée", calculé à l'affichage à partir de `endDate`/`missionEvents` comparés à la date du jour — jamais stocké, donc jamais désynchronisé de la réalité.

### `data/opportunites.json`

Tableau des besoins client détectés (pipeline avant mission), indépendants de tout consultant précis — un besoin peut avoir plusieurs candidats en parallèle (voir `candidatures.json`).

| Champ | Type | Description |
|---|---|---|
| `id` | string | Identifiant unique généré à la création. |
| `client` | string | Nom du client. |
| `clientService` | string | Service/pôle chez le client (optionnel). |
| `titre` | string | Intitulé du poste/besoin (optionnel). |
| `createdAt` | string (`YYYY-MM-DD`) | Date de création, réglée automatiquement une seule fois — jamais modifiable ensuite, y compris en édition. |
| `startDate` / `endDate` | string (`YYYY-MM-DD`) | Dates de mission prévisionnelles (optionnelles, indépendantes l'une de l'autre). Si les deux sont renseignées : reprises automatiquement dans la prestation si une candidature est gagnée, et utilisées pour tracer une barre "pipeline" dans le Gantt et dans le graphique "CA en négociation" des Statistiques, tant que le besoin reste `ouvert`. |
| `nature` | string | `mission` (régie), `forfait` ou `projet_interne` (optionnel — pas toujours connue dès la détection). |
| `tjm` | number | TJM estimé, en €/jour (optionnel). Avec `startDate`/`endDate`, sert à estimer le "CA en négociation" dans les Statistiques. |
| `fte` | number | Taux d'activité estimé, de 3 à 5 (optionnel). |
| `limiteUOAn` | number | Limite d'unités d'œuvre (jours) par an imposée par le client (optionnel, ex : 210/216/218 — vide si le client n'impose pas de limite). Repris automatiquement sur la prestation si une candidature est gagnée, comme le TJM estimé. |
| `status` | string | `ouvert` (en cours), `pourvu` (une candidature a gagné) ou `abandonne`. |

### `data/candidatures.json`

Tableau des candidatures : une ligne par couple (opportunité, consultant candidat).

| Champ | Type | Description |
|---|---|---|
| `id` | string | Identifiant unique généré à la création. |
| `opportuniteId` | string | Référence vers `id` dans `opportunites.json`. |
| `consultantId` | string | Référence vers `id` dans `consultants.json`. |
| `status` | string | `en_attente`, `gagnee` ou `perdue`. |
| `prestationId` | string | Référence vers `id` dans `prestations.json` (renseigné seulement quand `status` passe à `gagnee`). |
| `bookPushes` | array de `{ id, date }` | Journal des envois de CV/book au client (append-only, plusieurs envois le même jour possibles). |
| `soutenances` | array de `{ id, date, resultat }` | Journal des soutenances passées ; `resultat` : `en_attente`, `validee` ou `refusee`. |

Pour utiliser le projet sur une autre machine avec ses propres données, il suffit de copier tout le dossier du projet (y compris `data/`) — aucune installation autre que Node.js n'est nécessaire.
