# Options — Vue Prestation (macro + micro)

Rôle de ce fichier : structurer la décision. A-t-on vraiment pesé les alternatives ? Voir [evidence.md](evidence.md) pour ce qu'on sait du problème.

## Option 0 — Ne rien changer

Garder "Suivre la demande" tel quel : une fenêtre qui raisonne sur UNE prestation + UNE opportunité à la fois, avec tous les blocs (tarification, mission, candidatures) visibles ensemble.

- **Pour** : zéro effort, zéro risque de régression.
- **Contre** : ignore un retour de démo concret (densité, utilisateur perdu) ; ne répond pas au pain point manager/commercial (vue consolidée reconstruite à la main ailleurs, perte de temps individuelle et collective).

## Option 1 — Vue Prestation structurée en macro + micro (retenue)

Remplacer la logique actuelle (1 prestation + 1 opportunité à la fois) par une vue organisée autour de l'**entité** `client` + `clientService` (le besoin/projet, pas le client au sens large) :

- **Macro** : vue consolidée de l'entité — toutes les prestations qui partagent ce `client`+`clientService` affichées ensemble (frise chronologique globale, CA cumulé, statut d'ensemble). C'est la "data visualisation" en haut, celle qui donne la vue consolidée sans avoir à la reconstruire à la main.
- **Micro** : une ligne par consultant staffé sur cette entité, chacune avec son propre point d'action pour agir indépendamment (TJM, pauses, prolongation/sortie anticipée) sans impacter les autres consultants ni la vue macro — jamais plus d'un point d'action ouvert à la fois (règle déjà adoptée).

- **Pour** :
  - Répond directement au retour de démo (sépare la lecture d'ensemble de l'édition fine, au lieu de tout empiler).
  - Répond au pain point manager/commercial : la vue consolidée par besoin existe nativement dans l'outil, plus besoin de la reconstruire via d'autres outils/agrégateurs pour le reporting — le gain est du temps, pas seulement du confort visuel.
  - Beaucoup de réutilisation : les formulaires TJM/révisions, pauses/mission events, pushs/soutenances existent déjà (modale Prestation, modale Opportunité) — il s'agit de les réorganiser sous une nouvelle structure de page, pas de réinventer leur contenu.
  - Cohérent avec la clé de regroupement déjà actée (`client`+`clientService`) dans `decisions/gantt-vue-client-lignes-multiples/`.
- **Contre** :
  - Changement réel de structure de page, pas un simple ajustement visuel : il faut faire raisonner la vue par **groupe** de prestations (même entité) plutôt que par prestation isolée — nécessite une agrégation (CA cumulé, frise consolidée) qui n'existe pas encore sous cette forme.
  - Ouvre une question non tranchée (voir evidence.md) sur plusieurs candidatures/opportunités en parallèle pour le même besoin — à traiter dans le plan d'implémentation.

## Décision retenue

**Option 1**, décidée le 2026-10-11. Précisée le 2026-10-12 via wireframe (voir evidence.md) :
- La vue **reste la popup "Suivre la demande" existante**, refondue — pas un nouvel overlay séparé comme la première implémentation l'avait fait (retirée le 2026-10-11, voir outcome.md).
- **Macro** = indicateurs consolidés (nature/statut, durée, délai de réponse, staffing, CA) + 2 graphiques (CA, staffing) + accès aux **réglages de la prestation entière** (nature, limite d'UO, pauses — un seul jeu de réglages pour toute l'entité, pas par consultant).
- **Micro** = liste de staffing (une ligne par consultant, façon Vue liste) + accès au réglage individuel (dates, rôle, taux d'activité, **tarification**/TJM) — la tarification reste la seule chose vraiment propre à chaque consultant.
- Prochaine étape : plan d'implémentation détaillé (structure de page, composants réutilisés — en particulier les graphiques de la page Statistiques).

## Question ouverte — plusieurs opportunités en parallèle sur la même entité (pas retenue pour l'instant)

Piste notée le 2026-10-11, **non retenue pour l'implémentation actuelle** : réutiliser le mécanisme déjà existant des "barres pipeline" (`pipelineItemFromOpportunite()`/`pipelineItemFromCandidature()`, déjà utilisé en Gantt/Vue liste mode clients), mais à la granularité de l'entité `client`+`clientService` plutôt que du client au sens large — la vue macro agrégerait alors aussi bien les prestations gagnées que les opportunités encore ouvertes sur la même entité, et un bouton "+ Ajouter un besoin sur cette entité" ouvrirait la modale Opportunité déjà existante, pré-remplie.

- **Raison du report** : l'interface est déjà jugée trop dense (c'est le point de départ de cette décision). Le fait que la mécanique interne se précise (plusieurs postes possibles en parallèle sur une même entité) ne justifie pas, en soi, d'alourdir la vue macro tout de suite — pas un besoin confirmé à ce stade, juste une possibilité identifiée.
- **Trace** : notée ici pour référence future, et reportée au backlog (voir `BACKLOG.md`) plutôt que d'être incluse dans le plan d'implémentation actuel de la vue Prestation.
- **Toujours distinct** de la frise chronologique du wireframe (2026-10-12), qui montre les candidats non retenus d'un processus déjà clos pour les consultants affichés — pas des postes encore ouverts en parallèle. Pas de contradiction entre les deux.

## Question ouverte (nouvelle) — visibilité différenciée par profil dans cette page

Repérée le 2026-10-12 en construisant le wireframe (voir evidence.md) : la page affichera potentiellement des données sensibles (marge/coût complet, TJM des autres consultants) à filtrer selon le profil connecté (Manager/Commercial/Consultant) — rejoint l'écart déjà identifié dans les personas. **Explicitement reportée par l'utilisateur**, à traiter après la livraison de cette refonte, pas dans son scope initial.
