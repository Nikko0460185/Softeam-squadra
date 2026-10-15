# Evidence — Vue Prestation (macro + micro), remplacement de la densité de "Suivre la demande"

Rôle de ce fichier : ancrer la décision dans la réalité. Pas de solution ici, juste ce qu'on sait vraiment.

## Constat déclencheur

Retour direct d'une personne ayant fait une démo de l'outil : la fenêtre "Suivre la demande" (fusion Prestation/Opportunité) est trop dense, l'utilisateur s'y perd. Ce n'est pas une impression de l'équipe — c'est un retour terrain.

## Lien avec l'existant

- Le backlog contient déjà l'item **"Page dédiée Opportunité/Mission (pleine largeur)"**, noté comme "anticipation d'une demande terrain une fois le pipeline utilisé avec de vraies données" — cette anticipation vient de se confirmer.
- `decisions/gantt-vue-client-lignes-multiples/` a déjà établi qu'une "prestation" (`data/prestations.json`) est toujours rattachée à **un seul consultant** : plusieurs consultants sur le même besoin client = plusieurs enregistrements `prestations` distincts, partageant `client`/`clientService`.
- Règle adoptée dans cette même conversation (2026-10-11) : **jamais plus d'un popup ouvert à la fois** (voir la refonte de la gestion des commerciaux, déplacée du menu "Connecté" avec retour automatique au popup parent).

## Verbatims (conversation du 2026-10-11)

> "je trouve que la panneau de gestion des prestations est trop dense et que l'utilisateur est perdu. c'est confirmé par un retour d'une personne qui a fait une démo."

> "pourquoi il faut des popup pour générer les actions, car dans une prestation multi consultants, on doit pouvoir agir sur chacun indépendamment tout en gardant la spécificité du rendement de la prestation. Ainsi on passe de la micro gestion à du macro+micro."

> "à date y'a pas de demande de faire une vue client. mais une vue prestation de 1 ou plusieurs consultants chez 1 client dans une entité spécifique pour un besoin/projet identique. ce que couvre le nom de la prestation/entité."

> "le titre du profil n'entre pas en jeu, et dépend du consultant. il peut y avoir 3 consultants, un lead, un prod et un dev. ou bien un UXR et 2 product pour du design."

> "ça couvre aussi un pain point des managers et des commerciaux, global à l'outil : l'obligation de jouer entre plusieurs outils ou agrégateurs pour avoir une vue consolidée de leur action et portefeuille. ça prend du temps, individuellement et collectivement, à reconstruire ces infos pour les rendre compréhensibles pour eux-mêmes et pour leur reporting. le gain ici c'est le temps, au travers de l'efficacité fonctionnelle de la data visualisation."

## Clé de regroupement confirmée

`client` + `clientService` — **pas** `titre` (le titre du profil varie par consultant selon son rôle sur le même besoin : lead/prod/dev, ou 1 UXR + 2 product designers). C'est exactement la paire déjà utilisée partout dans l'affichage (ex: labels de barre Gantt, `buildTooltip()`) pour désigner une entité/besoin — rien de nouveau à inventer, juste à s'en servir comme clé de regroupement structurelle.

## Ce que ça ne change PAS (vérifié)

- **Ajout d'un 3e consultant sur un besoin existant** : suit le circuit déjà en place (opportunité → candidature → pushs/soutenance → gagnée → nouvelle prestation avec son propre TJM). `periodData()` calcule déjà le CA prestation par prestation, à partir de la propre date de début de chacune — aucun changement de calcul nécessaire.
- Le Gantt et la Vue liste n'ajoutent qu'une ligne de plus — pas de nouvelle logique d'affichage requise là non plus.

## Ce qu'on ne sait pas encore

- Dans la future vue Prestation, comment traiter le cas où plusieurs opportunités/candidatures sont ouvertes en parallèle pour le même besoin (plusieurs postes à pourvoir sur la même entité client+clientService) ? **Reporté** le 2026-10-11 : une piste a été notée (voir options.md, section "Question ouverte") mais volontairement **pas retenue pour l'implémentation actuelle** — l'interface est déjà jugée trop dense, la préciser sur ce point n'est pas un besoin confirmé à ce stade. Suivi au backlog plutôt que dans le plan d'implémentation de cette décision.

## Mise à jour du 2026-10-12 — wireframe

Une première implémentation (2026-10-11) a été retirée du tronc principal (voir outcome.md) : un point restait flou — où vivent les modalités de prestation (nature, limite d'UO) et les pauses. L'utilisateur a produit un wireframe pour trancher ce point avant de ré-intégrer la vue, plutôt que d'itérer directement dans le code.

### Ce que le wireframe précise

- **La popup garde son nom "Suivre la demande"** — ce n'est pas une vue séparée en plus de l'existante, c'est sa refonte.
- **En-tête** : nom du client + nom de l'entité (`client` + `clientService`).
- **5 cartes indicateurs macro** : (1) nature + statut, (2) durée — dates + jours restants, ajusté si prolongation, (3) délai de réponse cumulé (repris tel quel de l'actuelle "Suivre la demande", envoi → soutenance → démarrage), (4) staffing — voir ci-dessous, (5) CA — voir "CA max attendu" ci-dessous.
- **2 graphiques courbes**, même style que la page Statistiques : CA (prévisionnel vs accumulé), et Staffing (prévisionnel vs réel à date, incluant pauses client et absences consultants).
- **Commercial du compte** affiché en lecture seule.
- **Réglages de la prestation (macro)**, via un bouton dédié qui ouvre le détail : nom client/entité, statut, **nature**, **limite d'UO**, **réglages de pause**. Confirmé explicitement par l'utilisateur : *"les modalités de prestations et les limites d'UO sont attachées à la prestation et non plus aux consultants"* — un seul réglage pour toute l'entité (une pause est une décision côté client qui s'applique à tout le monde staffé), pas dupliqué par consultant comme c'était affiché dans la première implémentation retirée.
- **Liste du staffing (micro)**, façon Vue liste : une ligne par consultant — nom, rôle, date d'entrée, date de sortie (dernière prolongation le cas échéant), jours restants, TJM en cours, taux d'activité — avec un bouton vers le réglage individuel : dates, rôle, taux d'activité, **tarification** (TJM/révisions). Le TJM reste donc bien par consultant, contrairement à la nature/limite d'UO/pauses.
- **Frise chronologique** (bas de page) : du push/soutenance jusqu'à la sortie, **incluant les candidats non retenus** (le pipeline, pas seulement les gagnants). Pas besoin d'y montrer les pauses client (déjà dans les KPI macro) ; montrer en revanche les absences individuelles, un point par absence (date + durée).

### Comment stocker ces réglages macro — pas de migration du modèle de données

Tranché le 2026-10-12 : `nature`, `limiteUOAn`, `missionEvents` (pauses) et `commercialId` **restent** des champs sur chaque enregistrement `data/prestations.json` (un par consultant) — aucune nouvelle entité, aucune migration. Seule la *façon de les modifier* change : le bouton "réglages de la prestation" les écrit en une fois et les **propage** à tous les enregistrements qui partagent `client`+`clientService`, au lieu de les éditer un par un dans la modale de chaque consultant (qui ne les exposera plus directement, pour éviter toute divergence).

Risque accepté : si un enregistrement était modifié hors de ce bouton, il pourrait diverger de ses frères de la même entité — **exactement le même risque déjà identifié et accepté** pour `limiteUOAn` dans `decisions/jours-travailles-ca/options.md` (Option 3, 2026-08-28) : *"un même client avec plusieurs missions longues (>1 an) en parallèle chez des consultants différents devra voir la limite ressaisie sur chaque prestation — accepté comme risque mineur vu la fréquence attendue."* Ce n'est donc pas un risque nouveau — la propagation automatique via le bouton réglages l'améliore même, en remplaçant la ressaisie manuelle par une seule saisie propagée.

### CA max attendu vs CA accumulé — formules distinctes

Deux figures différentes, sources de données différentes, confirmées par l'utilisateur :
- **CA max attendu** (carte KPI, figé) = Σ pour chaque consultant engagé de `tjm` **initial** (le champ de base `p.tjm`, jamais `currentTjm()`) × jours ouvrés **vendus initialement** (`p.startDate` → `p.endDate`, la date de fin *prévue initialement* — jamais `effectiveEnd()`, qui bouge avec les prolongations). Calculé une seule fois à la signature, ne bouge plus jamais ensuite même si le TJM ou les dates changent — un repère fixe pour mesurer l'écart avec la réalité.
- **CA accumulé / prévisionnel** (graphique) = suit au contraire les valeurs courantes (`currentTjm()`, `effectiveEnd()`, pauses et absences réelles) — évolue dans le temps.

### Risque identifié et tranché — "staffing actif aujourd'hui" sur une prestation terminée

Même famille de confusion que le bug "CA à 0 quand terminée" déjà corrigé : si la carte Staffing n'affiche que les consultants actifs **aujourd'hui**, elle vaudra 0 pour une prestation terminée — alors que la page affiche en dessous tout un historique riche (frise, liste, CA accumulé total). Risque de lecture "la page a l'air cassée/vide".

**Décision (2026-10-12)** : double info sur la carte Staffing — nombre actif aujourd'hui **et** total historique affichés ensemble, plus la limite d'UO conservée sur la même carte.

### Reporté — visibilité différenciée par profil dans cette page

Repéré en marge du wireframe (2026-10-12) : cette page affichera potentiellement des données sensibles à filtrer selon qui regarde — marge/coût complet (Manager uniquement), TJM des autres consultants (masqué pour un profil Consultant qui ne devrait voir que sa propre ligne). Rejoint directement l'écart déjà identifié dans les personas (`decisions/` — le profil Consultant filtre la navigation mais pas les données dans une page partagée). **Explicitement reporté par l'utilisateur** : *"tu pointes le sujet des permissions. je te propose qu'on le traite après."* — à reprendre une fois cette refonte de "Suivre la demande" livrée, pas dans son scope initial.
