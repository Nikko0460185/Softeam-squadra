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

## Livré le 2026-10-16 au 2026-10-19 — chronologie du mode groupé, 3e passe

**Pauses/absences résumées, pas déroulées point par point** : `buildPrestationTimelinePoints()` ne montre plus les absences individuelles sur la frise (les pauses étaient déjà exclues depuis le 2026-10-12). Trois maquettes comparées avant d'implémenter (voir l'artifact "Chronologie prestation — options pause") : un point par pause tient pour 1-2 pauses mais devient illisible à l'échelle réelle (~3 pauses/an, une mission de 3 ans = ~8-9 points quasi identiques noyant démarrage/prolongations/fin) ; un bandeau partagé au-dessus des lignes ne peut pas être rattaché à une date précise d'aucune ligne (pas d'axe de dates commun dans cette frise) et reste trompeur dès 2 pauses. Retenu : deux pastilles résumées par ligne de consultant (`pauseDaysTotal()`/`absenceDaysTotal()`, nouvelle famille CSS `.summary-chip`/`.summary-chip-client`/`.summary-chip-consultant`, contour — documentée dans la skill `ui-coherence-squadra`), bornées à la fenêtre propre de chaque prestation (un consultant arrivé après une pause ne l'hérite pas).

**Bug corrigé — pauses sans `type`** : `addPrestationReglagesPause()` créait les pauses sans `type: 'pause'` depuis la toute première version de la modale Réglages (pas une régression de cette session — un commentaire resté lui aussi incomplet en est la preuve). Conséquence en cascade, repérée via les symptômes ("undefined" sur la frise, pastille absente) puis confirmée dans le code : `activePause()`/`unavailableFraction()` ne reconnaissaient pas non plus ces pauses, donc ni le statut "en pause", ni la réduction de CA/staffing sur les graphiques ne s'appliquaient pour les entités concernées. Corrigé à la source ; les pauses déjà enregistrées avant le correctif restent orphelines (invisibles même en rouvrant Réglages, qui filtre aussi sur `type==='pause'`) — nettoyage manuel documenté pour l'utilisateur (suppression depuis "Modification de la mission", qui ne les protège pas non plus faute de `type`, puis ressaisie).

**Non-retenus toujours après les staffés** : `renderSuiviDemandeGroupTimeline()` triait auparavant toutes les lignes ensemble par date, mélangeant consultants staffés et candidats perdus — un perdu ancien pouvait apparaître avant un staffé récent. Désormais deux groupes triés séparément, staffés toujours affichés en premier ("pas déterminants pour le suivi de la prestation").

**Lignes plus compactes** : les lignes de consultants staffés utilisaient `won:true` (pleine largeur, connecteurs étirés) — passées à `won:false` comme les lignes "non retenu", connecteurs à largeur fixe. Bug de conteneur manquant corrigé au passage : le mode groupé n'enveloppait jamais ses lignes dans `.sd-timeline-lanes` (seul le mode legacy le faisait) — le `gap` entre lignes ne s'appliquait donc à rien, lignes visuellement collées malgré la règle CSS.

**Espacement en `rem`, première exception du projet** : le gap nom↔frise et le gap entre lignes (`.sd-timeline-lane`/`.sd-timeline-lanes`) passent de valeurs en px à `1rem` — pour suivre le texte si la racine grandit un jour (réglage "agrandir le texte", backlog), contrairement au reste de l'espacement du projet encore en px. Décision assumée comme une exception ponctuelle, pas (encore) une généralisation.

## Vérification

- `node --check main.js`/`server.js` : syntaxe valide après chaque étape, aux trois dates de livraison.
- Fichiers statiques et `/api/data` servis sans erreur après chaque redémarrage du serveur.
- Balance des balises `<div>` vérifiée (247/247), tous les ids référencés en JS confirmés présents en HTML.
- `server.js` a changé pendant cette session (ajout de `commerciaux` à l'API, hors scope de cette décision) : vérification backend complète (`verify-squadra-backend`) passée le 2026-10-15 — fichiers statiques, round-trip d'écriture, robustesse JSON invalide, nettoyage des données réelles restaurées à l'identique après test.
- Rendu visuel réel confirmé par l'utilisateur à chaque lot via tests manuels guidés (pas d'outil de navigateur automatisé dans cet environnement) — y compris la découverte du bug `type` manquant sur les pauses, repéré par l'utilisateur sur une entité réelle puis diagnostiqué dans le code sans jamais lire `data/*.json` directement.
