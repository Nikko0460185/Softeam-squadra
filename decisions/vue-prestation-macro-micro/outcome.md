# Outcome — Vue Prestation (macro + micro)

Rôle de ce fichier : ce qui a été livré, une fois la décision passée à l'exécution. Voir [evidence.md](evidence.md) et [options.md](options.md) pour le constat et les alternatives pesées.

## Livré le 2026-10-12 — refonte de "Suivre la demande" (pas un nouvel overlay)

Après la mise en pause du 2026-10-11 (1re implémentation retirée de `main`, préservée sur la branche `vue-prestation-wip`), l'utilisateur a fourni un wireframe qui tranche le point resté flou (où vivent nature/limite d'UO/pauses) et précise toute la structure. Implémenté directement dans la popup existante "Suivre la demande" (`openSuiviDemande()`, [main.js](../../main.js)), qui bascule maintenant entre 2 modes :

- **Mode groupé** (dès qu'une prestation existe pour l'entité `client`+`clientService`) : `openSuiviDemandeGroup()` — 5 cartes KPI (nature/statut, durée, délai de réponse moyen, staffing actif+historique+limite d'UO, CA accumulé+CA max attendu), 2 graphiques (`buildTwoLineChart()`, nouvelle variante à 2 séries de `buildLineChart()`, zéro dépendance externe), bouton "Réglages de la prestation", liste des consultants staffés (édition individuelle), frise chronologique (consultants gagnés + candidatures non retenues + absences individuelles).
- **Mode legacy** (opportunité pas encore gagnée) : comportement d'origine strictement inchangé.

**Modèle de données** : aucune migration — `nature`/`limiteUOAn`/`missionEvents` (pauses)/`commercialId` restent des champs sur chaque `data/prestations.json`, mais ne sont plus modifiables dans la modale Prestation d'un consultant (devenus des champs cachés) : une nouvelle modale "Réglages de la prestation" (`openPrestationReglagesModal()`) les édite une fois et les **propage** à tous les enregistrements de l'entité (`prestationsForEntity()`). Risque de divergence déjà accepté pour `limiteUOAn` dans `decisions/jours-travailles-ca/` (2026-08-28), même logique ici.

**Formules nouvelles** : `caMaxAttendu()`/`caMaxAtDate()` (figé, valeurs initiales `p.tjm`/`p.endDate`, jamais recalculé) et `caAccumuleADate()`/`caAtDate()` (dynamique, `currentTjm()`/`effectiveEnd()`, réduit par pauses/absences via `unavailableFraction()` déjà existante) — formules distinctes confirmées explicitement par l'utilisateur.

**Jamais plus d'un popup ouvert à la fois** : "Modifier" sur un consultant ou "Réglages de la prestation" ferment "Suivre la demande" avant d'ouvrir leur modale standalone, et y reviennent automatiquement en sortie (`returnToSuiviDemande()`/`suiviDemandeReturnEntity`, branché dans `cancelPrestModal()`/`savePrestation()`/`deletePrestation()` et les 2 fonctions de sortie de la modale Réglages).

**Hors scope, reporté au backlog** : afficher les opportunités encore ouvertes en parallèle sur la même entité (voir options.md, "Question ouverte") ; visibilité différenciée par profil (Manager/Commercial/Consultant) dans cette page, repérée en marge du wireframe et explicitement reportée par l'utilisateur.

## Livré le 2026-10-15 — retours de démo, 2e passe

Après un premier passage utilisateur sur la refonte du 2026-10-12, plusieurs retours ciblés :

**Accès à l'opportunité d'origine** : un seul bouton après la frise chronologique (pas un par consultant — "plusieurs opportunités en parallèle sur la même entité" jugé hors cas d'usage réel de l'outil), dédupliqué par `opportuniteId` (`renderSuiviDemandeGroupOppLinks()`). Rouvre l'interface legacy de gestion des candidatures (continuité d'interface demandée explicitement) via `openSuiviDemandeLegacy()`, extraite pour contourner la résolution automatique prest↔opp qui aurait sinon ramené une opportunité déjà gagnée en mode groupé. Retour automatique au mode groupé à la fermeture (même mécanisme `suiviDemandeReturnEntity` que pour "Réglages de la prestation").

**Graphiques CA/Staffing** : deux bugs corrigés. (1) L'échantillonnage mensuel n'évaluait "réel" qu'en fin de mois, rendant invisible toute absence/pause dans le mois en cours — `reelAsOf()` plafonne désormais au jour présent pour le mois courant. (2) Le staffing réel était un décompte entier de consultants actifs (binaire) ; passé à une somme de taux d'activité journaliers fractionnaires (1 / 0,75 / 0,5 / 0,25 / 0, convention apportée par l'utilisateur) via `unavailableFraction()`, avec affichage à 1 décimale (`buildTwoLineChart({decimals:1})`).

**Tableau "Consultants staffés"** : table dédiée (`buildStaffingTableHtml()`/`.sd-staffing-row`, pas `buildUnifiedTableHtml()` de la Vue liste) — pas de rappel d'entité par ligne (déjà en en-tête de page), nouvelle colonne "Restant" (jours jusqu'à `effectiveEnd()`). Commercial de l'entité remonté en en-tête de page, à côté du nom client/entité, taille de texte `--text-xl`.

**Généralisé ensuite à la Vue liste** (même retour terrain — cohérence entre les 2 tableaux) : même ordre de colonnes (Statut·Type·Profil·Qui·Dates·Restant·TJM·Occupation·Modifier), la colonne "Restant" fusionne l'ancienne alerte dédiée fin-de-mission (rouge ≤30j, orange ≤90j — seuils inchangés, juste déplacés).

**Pastille "Type" retirée partout** (`.nature-badge`/`natureBadge()` supprimés) : un retour utilisateur confirme qu'elle ne s'intégrait pas aux nouvelles interfaces — texte simple coloré partout désormais (Vue liste, Consultants staffés, carte KPI "Nature & statut", tableau Statistiques "Répartition par client").

**"Activité" renommé "Occupation"/"Taux d'occupation"** partout (labels de formulaire, en-têtes de tableau, cartes KPI, toast d'erreur) — terme jugé mal choisi par les utilisateurs, y compris pour le taux d'occupation période (%) des Statistiques, déjà nommé ainsi en interne dans le code avant ce renommage.

## Vérification

- `node --check main.js`/`server.js` : syntaxe valide après chaque étape, aux deux dates de livraison.
- Fichiers statiques et `/api/data` servis sans erreur après chaque redémarrage du serveur.
- Balance des balises `<div>` vérifiée (247/247 au 2026-10-15), tous les ids référencés en JS confirmés présents en HTML.
- `server.js` a changé pendant cette session (ajout de `commerciaux` à l'API, hors scope de cette décision) : vérification backend complète (`verify-squadra-backend`) passée le 2026-10-15 — fichiers statiques, round-trip d'écriture, robustesse JSON invalide, nettoyage des données réelles restaurées à l'identique après test.
- **Non vérifié** : rendu visuel réel (pas d'outil de navigateur automatisé dans cet environnement) — confirmé au fil de l'eau par l'utilisateur via tests manuels guidés après chaque lot de changements.
