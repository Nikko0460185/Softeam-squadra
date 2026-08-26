---
name: accessibilite-rgaa-squadra
description: Use when the user asks to check accessibility or RGAA compliance for SQUADRA ("vérifie l'accessibilité", "audit RGAA", "conformité RGAA", "les 106 critères"). Audits index.html/main.js/styles against the current official RGAA criteria (fetched live, not from memory), reports the status of every applicable criterion with file:line, and fixes the safe/mechanical violations directly.
---

# Accessibilité RGAA — SQUADRA

Audite SQUADRA par rapport au RGAA (Référentiel Général d'Amélioration de l'Accessibilité), le référentiel français officiel. Complémentaire à `ui-coherence-squadra` (cohérence interne du design system) — celle-ci porte sur la conformité réglementaire.

**Cette skill est un filet de sécurité, pas le seul mécanisme.** `ui-coherence-squadra` porte désormais une base de conventions d'accessibilité attendues dès la conception (bouton icône → `aria-label`, toast → `aria-live`, groupe de filtres → `role="group"`, onglets → motif ARIA complet, zone scrollable custom → `tabindex`+`aria-label`, etc.) — un audit RGAA complet ici sert à vérifier la conformité formelle et rattraper ce qui aurait été manqué, pas à découvrir ces bases pour la première fois.

## ⚠️ Toujours vérifier la version en vigueur avant d'auditer

**Ne jamais s'appuyer sur une liste de critères mémorisée d'une session précédente.** Le référentiel évolue : la version en cours au moment de la création de cette skill était le **RGAA 4.1.2** (13 thématiques, 106 critères), mais une **RGAA 5** est annoncée pour fin 2026 — au-delà de cette date, la structure et le nombre de critères peuvent avoir changé.

En tout début d'audit :
1. `WebFetch` sur `https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/` pour confirmer la version en vigueur et récupérer la liste réelle des critères/tests à jour.
2. Si la page a changé de structure ou que la version affichée n'est plus 4.1.2, adapter l'audit à ce qui est réellement publié — ne pas forcer les résultats dans l'ancienne structure à 13 thématiques/106 critères si elle a été remplacée.
3. Ne pas essayer de retenir/résumer les 106 critères dans cette skill de façon statique : la source de vérité reste toujours la page officielle, consultée à chaque audit.

## Périmètre applicable à SQUADRA

SQUADRA est une app HTML/CSS/JS pure (pas de rendu serveur de contenu éditorial, pas de PDF, pas de vidéo, pas de `<iframe>` a priori) : les thématiques **Multimédia**, **Cadres** et **Consultation** sont probablement non applicables en l'état — à reconfirmer à chaque audit plutôt que supposer, car le projet évolue. Les thématiques les plus susceptibles d'être concernées : **Couleurs** (thème sombre, badges colorés — `styles/tokens.css`, `styles/atoms/badges.css`), **Formulaires** (modales `index.html`, validation `main.js`), **Scripts** (interactions JS : `onclick`, modales, tooltips), **Structuration**/**Présentation de l'information**, **Liens**, **Navigation**, **Éléments obligatoires** (lang, titre de page), **Tableaux** (tableaux de la vue Statistiques).

## Étapes

1. Récupérer la liste de critères à jour (voir section précédente).
2. Pour chaque critère applicable au périmètre de SQUADRA, vérifier dans `index.html`, `main.js` (templates générés) et `styles/` : conforme / non conforme / non applicable.
3. Points d'attention concrets pour ce projet, à titre de départ (pas une liste exhaustive — la source officielle fait foi) :
   - Contraste des couleurs de texte/fond, y compris les badges (`.pill-*`, `.status-pill`) et le texte muted sur fond sombre.
   - Tous les champs de formulaire ont un `<label>` associé (pas juste un placeholder).
   - Les boutons icône-seule (`.btn-icon`) ont un `aria-label` explicite. `title` seul ne fait office de nom accessible que si le bouton n'a **aucun** texte visible (icône SVG pure) — dès qu'il y a un caractère/texte visible (ex: "‹", "×"), c'est lui qui devient le nom accessible et le `title` est ignoré par les lecteurs d'écran pour ça (reste utile comme infobulle visuelle uniquement).
   - Le focus clavier est visible sur tous les éléments interactifs (boutons, liens, champs).
   - Les éléments cliquables custom (div avec `onclick`) sont-ils accessibles au clavier, ou faut-il un vrai `<button>` ?
   - `lang="fr"` sur `<html>`, titre de page pertinent.
   - Les tableaux (vue Statistiques) ont des `<th>` correctement scopés.
4. Documenter chaque non-conformité avec le numéro exact du critère RGAA concerné (ex: "9.3"), pas une paraphrase approximative.

## Corrections automatiques

Corriger directement ce qui est mécanique et sans ambiguïté : `aria-label` manquant, `<label for>` non associé, `lang` manquant, contraste insuffisant corrigeable via une variable de `tokens.css`, `alt` manquant. Signaler sans corriger seul(e) tout ce qui demande un choix de conception (restructurer la navigation clavier, réécrire un composant custom en éléments sémantiques natifs) — proposer la correction à l'utilisateur avant de l'appliquer.

## Rapport

Un tableau par thématique applicable : critère RGAA (numéro), statut (Conforme / Non conforme / Non applicable), fichier:ligne si non conforme, correction appliquée ou à valider. Terminer par un résumé chiffré (X conformes / Y non conformes / Z non applicables sur le total de critères applicables).
