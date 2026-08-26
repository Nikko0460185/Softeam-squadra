---
name: verify-squadra-frontend
description: Use when the user asks to verify, test, or check the SQUADRA frontend/UI/app behavior ("teste le front", "vérifie l'appli", "teste l'interface", "verify-squadra frontend"). Guides an end-to-end functional check in the browser — add a test collaborator + mission, verify KPI impact, clean up in the correct order.
---

# Verify SQUADRA — Frontend

Vérifie le comportement réel dans le navigateur : l'app SQUADRA elle-même (pas seulement le serveur — voir `verify-squadra-backend` pour ça). À lancer après toute modification de `main.js` (rendu, calculs de statistiques) ou des fichiers `styles/`.

## Prérequis

Le serveur doit tourner (voir `verify-squadra-backend`, section Prérequis). Ouvrir `http://localhost:3000` dans le navigateur — utiliser le skill `/run` du projet si disponible pour piloter l'app ; sinon guider l'utilisateur pas à pas et lui demander de confirmer ce qu'il voit à chaque étape.

## Données de test

- **Collaborateur** : nom `TEST_SKILL Verify`, coût complet `300`
- **Prestation** sur ce collaborateur : statut `En cours`, client `Client Test`, dates couvrant le trimestre en cours, TJM `500`, FTE `5`, nature `Mission`
- **Opportunité** : client `Client Test` (même client, pour vérifier le regroupement), titre `Poste Test`, dates de début/fin prévues renseignées (ex. début dans 1 mois, fin dans 4 mois — doit tomber dans la fenêtre de 36 mois du Gantt)
- **Candidature** sur cette opportunité : le collaborateur `TEST_SKILL Verify`

## Étapes

1. Noter les valeurs actuelles du bandeau KPI (vue Statistiques) avant toute modification : consultants en mission, taux d'occupation, TJM moyen, CA confirmé, CA total prévisionnel, masse salariale, marge brute, taux de marge, objectif CA.
2. Ajouter le collaborateur de test, puis la prestation de test dessus.
3. Revérifier chaque KPI noté à l'étape 1 : il doit avoir évolué dans le sens attendu (augmentation), ou apparaître s'il affichait "—" faute de données financières.
4. Vérifier visuellement : la ligne du collaborateur test dans le tableau d'occupation, la barre de la période courante dans le graphique CA, la ligne `Client Test` dans le tableau clients, la prestation visible en vue Gantt et en vue Liste.
5. **Pipeline Opportunité** — dans la Vue liste, basculer en mode "Clients", créer l'opportunité de test (`+ Ajouter une opportunité` ou `+ Opportunité` sur la carte `Client Test`, avec ses dates de début/fin prévues), y ajouter la candidature de test, puis dans la même fenêtre : ajouter 1 push de book et 1 soutenance (résultat "Validée"). Vérifier que la ligne apparaît dans le tableau unifié de la carte `Client Test` (badge de type "OPPORTUNITÉ" en contour, pastille de statut "Ouvert") ET dans la carte du collaborateur en mode "Consultants" (pastille candidature "En attente"). Vérifier aussi la ligne "Créée le [date]" en texte simple (non modifiable) dans la modale Opportunité.
6. **Pipeline dans le Gantt** — basculer en Vue Gantt : vérifier qu'une barre pointillée violette ("pipeline") apparaît sur la ligne du collaborateur `TEST_SKILL Verify` (mode "Consultants", légende du Gantt), aux dates prévues de l'opportunité, avec un clic qui ouvre la modale Opportunité (pas Prestation). Basculer "Clients" dans la légende du Gantt : la même barre apparaît sur la ligne `Client Test`, et l'en-tête de colonne passe de "Consultant" à "Client". Filtrer "Type" → "Prestations" : la barre disparaît (dans les 2 modes) ; → "Opportunités" : elle seule reste. Remettre les filtres à "Tous".
7. Marquer la candidature "Gagnée" (✓) : vérifier que la modale Prestation s'ouvre préremplie (consultant, client `Client Test`, **et les dates reprises de l'opportunité**) — l'enregistrer avec un TJM quelconque. Revérifier que la candidature passe "Gagnée" et l'opportunité "Pourvu", que la nouvelle prestation apparaît dans le tableau unifié des deux vues, et qu'en Vue Gantt la barre pipeline a disparu au profit d'une vraie barre pleine (dans les 2 modes Consultants/Clients).
8. **Nettoyage, dans cet ordre impératif** : supprimer d'abord la prestation créée en gagnant l'opportunité (étape 7), puis l'opportunité de test elle-même (sa candidature est supprimée en cascade automatiquement), puis la prestation de test de l'étape 2, et enfin le collaborateur de test en dernier. (Supprimer le collaborateur en premier laisserait des prestations/candidatures orphelines — `deleteConsultant()` ne supprime pas les prestations liées, et une candidature `gagnee` ne peut pas être retirée manuellement tant que sa prestation existe.)
9. Revérifier que chaque KPI est revenu à sa valeur de l'étape 1.
10. Recharger la page et confirmer qu'aucune trace du collaborateur, des prestations ou de l'opportunité de test ne subsiste nulle part (persistance réelle de la suppression, pas juste en mémoire).
11. **Vérification accessibilité rapide** (contrôle de fumée, pas un audit complet — voir `accessibilite-rgaa-squadra` pour ça) sur tout contrôle interactif nouveau ou modifié depuis le dernier passage de cette skill : Tab jusqu'à chaque bouton/champ/zone concerné et confirmer que ce que le lecteur d'écran annoncerait a du sens (un bouton icône seule ne doit pas se réduire à un glyphe illisible, cf. `ui-coherence-squadra`) ; confirmer qu'aucun message ou distinction d'état ne repose uniquement sur la couleur ; pour une zone scrollable/interactive custom (ex. chronologie Gantt), confirmer qu'elle est atteignable et utilisable au clavier, pas seulement à la souris.

## Rapport

Lister chaque étape avec son résultat (OK / échec). Si le nettoyage (étape 8) échoue à un moment, le signaler immédiatement à l'utilisateur avant de conclure — ne jamais laisser de données de test dans l'outil.
