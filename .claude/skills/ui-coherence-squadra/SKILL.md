---
name: ui-coherence-squadra
description: Use when the user asks to check or fix UI consistency in SQUADRA ("vérifie la cohérence UI", "harmonise les boutons/formulaires", "audit design system", "les éléments graphiques ne sont pas cohérents"). Audits buttons, form fields, badges/pills and spacing against the project's own design system conventions, reports every inconsistency found, and fixes the safe ones directly.
---

# Cohérence UI — SQUADRA

Vérifie que les éléments graphiques équivalents (même rôle, même intention) sont traités de façon identique partout dans l'app — et pas seulement esthétiquement : aussi en fiabilité de saisie (validation, messages d'erreur, comportement au clic). Exemple qui a motivé cette skill : le bouton "Nouvelle prestation" (topbar, `.btn-primary`, fond plein) et "Ajouter un consultant" (sidebar, `.btn-add-consultant`, contour pointillé) sont deux styles différents pour la même intention ("créer une nouvelle entité").

Complémentaire à `accessibilite-rgaa-squadra` (accessibilité réglementaire) — celle-ci se concentre sur la cohérence interne du design system, indépendamment du RGAA.

## Convention de référence

Ces règles reflètent l'état voulu du design system (`styles/atoms/`, `styles/molecules/`) — à mettre à jour ici si le projet fait évoluer volontairement une convention.

| Rôle sémantique | Classe | Exemples actuels |
|---|---|---|
| Créer une nouvelle entité de premier niveau (prestation, consultant) | `.btn-primary` | "Nouvelle prestation" ; **"Ajouter un consultant" doit rejoindre cette classe** (actuellement `.btn-add-consultant`, à corriger) |
| Ajouter une ligne secondaire à l'intérieur d'un formulaire déjà ouvert (ex: révision de TJM) | `.btn-add-small` | "+ Ajouter" (modale prestation) — légitimement plus discret, poids visuel inférieur assumé |
| Action neutre / annuler | `.btn-secondary` | "Annuler" |
| Action destructrice | `.btn-danger` | "Supprimer" |
| Action icône seule (modifier, fermer) | `.btn-icon` | crayon d'édition, croix de fermeture de modale |
| Badge de statut (prestation, consultant, opportunité, candidature) | `.status-pill` + variante `.pill-*` | `.pill-en_cours`, `.pill-arrivee`, `.pill-sortie`, `.pill-opp-*`, `.pill-cand-*`... |
| Badge de type/nature (mission, opportunité) | `.nature-badge` + variante `.nature-*` — **fond transparent + bordure**, volontairement différent du fond plein de `.status-pill` (2 axes d'info distincts, parfois même teinte : ex. Mission et Opportunité en bleu) | `.nature-mission`, `.nature-forfait`, `.nature-opportunite`... |

Toute nouvelle classe de bouton ou de badge qui ne rentre pas dans ce tableau est un signal d'incohérence à signaler — pas à créer silencieusement une 6e variante. En particulier : un nouveau badge de **statut** doit avoir un fond plein (`background: var(--x-soft)`) ; un nouveau badge de **type** doit être en contour (`background: transparent; border: 1px solid currentColor`) — ne pas mélanger les deux styles au sein d'une même famille.

## Accessibilité de base — attendue dès la conception, pas seulement au moment d'un audit

Ces motifs doivent être appliqués **au moment où le composant est créé**, comme le reste des conventions ci-dessus — ce ne sont pas des corrections à faire après coup. `accessibilite-rgaa-squadra` reste l'audit formel de conformité RGAA (numéros de critères, rapport chiffré) ; ce qui suit est la base minimale attendue en continu, indépendamment de tout audit.

| Motif | Convention attendue | Piège à éviter |
|---|---|---|
| Bouton icône seule (`.btn-icon`, ex: ‹ › × crayon) | `aria-label` explicite décrivant l'action | `title` seul ne suffit **que** si le bouton n'a aucun autre texte visible (ex: une icône SVG pure) — dès qu'il y a un caractère/texte visible (ex: "‹"), c'est LUI qui devient le nom accessible, pas le `title` |
| Message de statut ponctuel (toast, confirmation) | `role="status"` + `aria-live="polite"` sur le conteneur, présent dans le DOM dès le chargement (pas inséré dynamiquement) | Un texte qui apparaît/disparaît sans `aria-live` n'est jamais annoncé |
| Groupe de boutons à choix unique (filtres, bascule de vue) | `role="group"` + `aria-labelledby` vers une étiquette visible à côté | Un groupe de boutons sans étiquette reliée ne dit pas ce qu'il regroupe |
| Bascule persistante entre 2+ vues (onglets) | Motif ARIA complet : `role="tablist"`/`role="tab"`/`aria-selected`/`role="tabpanel"`/`aria-labelledby` | De simples boutons stylés "comme des onglets" ne sont pas annoncés comme des onglets |
| Zone scrollable/interactive custom (ex: chronologie) | `tabindex="0"` + `aria-label` (nom) + `aria-describedby` si le mode d'emploi n'est pas évident + gestion clavier explicite si le scroll natif seul ne couvre pas l'usage prévu | Une instruction d'usage écrite à côté, non reliée par `aria-describedby`, n'est jamais atteinte par quelqu'un qui navigue de contrôle en contrôle |
| Champ obligatoire/optionnel | Texte explicite `(obligatoire)`/`(optionnel)` à côté du label | Un symbole seul (`*`) sans légende associée n'est pas toujours perçu/compris |
| Erreur de validation sur un champ | Surbrillance visuelle **+** `aria-invalid="true"` sur le champ concerné, en plus du message | Un message d'erreur seul (toast) sans marquer le champ oblige à deviner lequel corriger |

## Étapes

1. Lister tous les boutons (`grep` sur `class="btn-` dans `index.html` et sur les templates générés dans `main.js`) et leur rôle sémantique déduit du texte/contexte.
2. Comparer chaque bouton trouvé au tableau ci-dessus : même rôle → même classe attendue. Signaler tout écart (fichier, ligne, classe utilisée vs classe attendue).
3. Vérifier les formulaires (`styles/molecules/form-group.css`, modales dans `index.html`) : mêmes espacements, mêmes styles de label/erreur, mêmes règles de validation appliquées de façon identique sur des champs de même nature (ex: tous les champs date obligatoires doivent avoir le même comportement de validation).
4. Vérifier les badges/pills (`styles/atoms/badges.css`) : une seule famille de style par nature d'information (statut de prestation, statut d'entrée/sortie...), pas de doublon visuel pour un même sens.
5. Vérifier la fiabilité en entrée : les champs qui doivent être obligatoires le sont réellement côté JS (`main.js`, ex: `saveConsultant()`, `savePrestation()`), pas juste visuellement suggérés.
6. Vérifier chaque motif du tableau "Accessibilité de base" ci-dessus sur les composants concernés (boutons icône, toasts, groupes de filtres, onglets, zones scrollables custom, champs obligatoires, erreurs de validation).

## Corrections automatiques

Appliquer directement les corrections sûres et mécaniques (remplacer une classe CSS par la classe attendue du tableau, aligner un espacement/rayon sur `tokens.css`, dupliquer une règle de validation manquante sur un champ équivalent, ajouter un `aria-label`/`role`/`aria-live` manquant conforme au tableau d'accessibilité ci-dessus). Ne **pas** corriger seul(e) un cas ambigu où plusieurs conventions existantes pourraient légitimement gagner (ex: si deux styles de boutons ont chacun des usages nombreux), ni un cas qui demande de restructurer un composant custom en éléments sémantiques natifs — le signaler à l'utilisateur pour trancher avant d'agir.

## Rapport

Lister chaque incohérence trouvée : fichier, ligne, ce qui cloche, la correction attendue. Distinguer clairement ce qui a été corrigé automatiquement de ce qui reste à trancher manuellement.
