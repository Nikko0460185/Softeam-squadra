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

## Typographie (taille de texte)

Barème défini dans `styles/tokens.css` : `--text-2xs` à `--text-2xl`, entièrement en **rem** — migration terminée le 2026-08-29 (les 131 `font-size` en px du projet, CSS + inline dans `main.js`/`index.html`, sont toutes passées par un de ces tokens ; zéro px codée en dur restante). Condition nécessaire pour qu'un futur réglage "agrandir le texte" (taille de la racine, pas encore construit — voir BACKLOG.md) ait un effet réel sur tout le texte.

`--text-2xs` à `--text-lg` valent actuellement toutes **0,8rem** (12,8px ≈ 9,6pt) — un plancher testé et choisi par l'utilisateur (pas une obligation RGAA/WCAG, aucune des deux ne fixe de taille minimale ; seul le redimensionnement à 200%, déjà garanti par le rem, est une vraie exigence). Ne jamais redescendre en dessous de ce plancher pour ces tokens sans une décision explicite de l'utilisateur, même si un usage semble justifier plus petit ; ne pas non plus réintroduire de hiérarchie de taille entre ces paliers de sa propre initiative — c'est un aplatissement volontaire, pas un oubli.

Toute nouvelle taille de texte doit utiliser un des tokens `--text-*` existants, jamais une valeur px ou rem arbitraire — si aucun token ne correspond à un usage repéré, le signaler plutôt qu'en inventer un 9e silencieusement. Un `font-size` en px qui réapparaîtrait (nouveau code, copier-coller depuis un ancien exemple...) doit être signalé et migré immédiatement — la migration étant terminée, tout px restant est une régression, pas juste une dette en attente.

## Hiérarchie visuelle des titres (H1, H2, H3...)

Décision du 2026-09-16 (explicite, utilisateur) : le H3 (`.section-title`) et le H2 de modale (`.modal-header h2`) doivent avoir le **même style visuel** — même taille, même poids, pas de hiérarchie de taille entre eux. Ce qui marque le début d'une nouvelle section n'est pas une taille de police différente, mais un **espace fort avant** (`margin-top`) : plus l'espace au-dessus d'un titre est grand, plus il se lit comme "on change de sujet". Cohérent avec la décision déjà actée de garder `--text-2xs`→`--text-lg` aplatis à 0,8rem (voir plus haut) : l'outil ne cherche pas à construire de hiérarchie par la taille, mais par l'espacement.

Ne pas réintroduire de hiérarchie de taille entre H2/H3 (ex: agrandir le H2 au-delà du H3, ou l'inverse) sans une nouvelle décision explicite de l'utilisateur — un essai en ce sens a déjà été fait et écarté le 2026-09-16.

**Règle d'espacement (précisée le 2026-09-16)** : l'espace avant un titre est LE seul signal de début de section — jamais de filet/ligne (`border-top`) en plus, même porté par le bloc qui précède. Un `border-top` à côté d'un titre est systématiquement un candidat à retirer au profit du seul `margin-top` constant de `.section-title` (32px, `styles/organisms/stats.css`). Exception unique : aucun espace (`margin-top:0` en inline) si le titre est le tout premier élément de la page/modale (rien à séparer avant lui) — ex: "Modalités de la prestation" (1er de la modale Prestation), "Indicateurs" (1er de "Suivre la demande"). Un titre qui n'est pas le tout premier élément (ex: "Prestation"/"Opportunité" dans "Suivre la demande", qui viennent après les KPI) garde le `margin-top` par défaut, sans filet ni marge spéciale supplémentaire au niveau du conteneur.

| Niveau | Rôle | Taille | Poids/couleur | Exemple |
|---|---|---|---|---|
| H1 | Titre de page unique | — | — | **N'existe pas encore dans l'outil** (SPA sans titre de page visible) — ne pas en inventer un sans raison ; si un jour introduit (ex: nom de l'appli dans la sidebar), le signaler pour trancher, pas décider seul(e) |
| H2 | Titre de modale/dialogue (`.modal-header h2`) — un seul par modale | `--text-lg` | 600, couleur héritée (pleine opacité) | "Ajouter une opportunité", "Suivre la demande" |
| H3 (`.section-title`) | Toute section structurante : sous-section de modale, zone de "Suivre la demande" ("Indicateurs"/"Prestation"/"Opportunité"), groupe de KPI hors modale (Statistiques) | `--text-lg` (même taille que le H2) | 600, couleur héritée — **même style que le H2**, pas de MAJUSCULES/`letter-spacing`/couleur atténuée | "Modalités de la prestation", "Tarification", "Prestation" (zone), "Activité · Q3 2026..." |

Piège à éviter : les boîtes `#prest-modal-box`/`#opportunite-modal-box` sont réutilisées à l'identique entre les modales de création ("Ajouter...") et "Suivre la demande" (`main.js openSuiviDemande()`, reparenting DOM) — leurs propres titres H3 ("Modalités de la prestation"...) ne peuvent donc pas changer de **niveau de balise** (H3→H4) selon le contexte sans dupliquer le HTML. Comme H2 et H3 partagent maintenant le même style, ce n'est plus un problème pratique (rien à distinguer visuellement entre eux) — mais si une vraie hiérarchie de niveaux (H3→H4) était décidée un jour, cette contrainte de duplication du HTML resterait entière.

Autre piège : `.section-title` ne doit être posée que sur un vrai titre de section (marque le début d'un groupe de contenu). Ne pas la réutiliser pour un simple label inline au look "gras/discret" (ex: un `<span>` d'étiquette à côté d'un filtre) — ça hérite alors du `margin-top:32px` pensé pour un titre de bloc, incohérent sur un élément en ligne ; utiliser `.form-label` pour ce cas (déjà le motif attendu pour un label, voir tableau des boutons/badges plus haut).

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
| Label de champ de formulaire (`<label>`) | `for="<id du champ>"` systématique | Un `<label>` positionné juste au-dessus/à côté du champ **semble** associé visuellement mais ne l'est pas programmatiquement sans `for` — trouvé sur 38/38 labels du projet le 2026-08-29, jamais rattrapé avant l'audit RGAA |
| En-tête de tableau (`<th>`) | `scope="col"` (ou `scope="row"` si c'est un en-tête de ligne) systématique | Un tableau sans `scope` reste lisible visuellement mais un lecteur d'écran ne relie plus la cellule à sa colonne en navigation cellule par cellule |
| Titre de section visuel (ex: `.section-title`, `.sidebar-section-title`) | Vraie balise de titre (`<h2>`/`<h3>`...), pas un `<div>`/`<span>` stylé comme un titre | Un texte qui a l'air d'un titre (gras, majuscules, couleur atténuée) n'est annoncé comme titre par un lecteur d'écran que si c'est réellement une balise Hn — cohérence de niveau à respecter avec le `<h2>` déjà présent dans la modale/page englobante |
| Information de statut portée par une couleur (badge, point, texte coloré) | Un signal non-coloré en plus (mot, forme, motif, barré...) | Une distinction uniquement chromatique (ex: vert vs gris, ou 2 formes rondes de couleurs différentes) est invisible pour un daltonien ou en niveaux de gris — vérifié cas par cas, ne pas supposer qu'un badge de statut existant suit déjà la règle |

## Étapes

1. Lister tous les boutons (`grep` sur `class="btn-` dans `index.html` et sur les templates générés dans `main.js`) et leur rôle sémantique déduit du texte/contexte.
2. Comparer chaque bouton trouvé au tableau ci-dessus : même rôle → même classe attendue. Signaler tout écart (fichier, ligne, classe utilisée vs classe attendue).
3. Vérifier les formulaires (`styles/molecules/form-group.css`, modales dans `index.html`) : mêmes espacements, mêmes styles de label/erreur, mêmes règles de validation appliquées de façon identique sur des champs de même nature (ex: tous les champs date obligatoires doivent avoir le même comportement de validation).
4. Vérifier les badges/pills (`styles/atoms/badges.css`) : une seule famille de style par nature d'information (statut de prestation, statut d'entrée/sortie...), pas de doublon visuel pour un même sens.
5. Vérifier la fiabilité en entrée : les champs qui doivent être obligatoires le sont réellement côté JS (`main.js`, ex: `saveConsultant()`, `savePrestation()`), pas juste visuellement suggérés.
6. Vérifier chaque motif du tableau "Accessibilité de base" ci-dessus sur les composants concernés (boutons icône, toasts, groupes de filtres, onglets, zones scrollables custom, champs obligatoires, erreurs de validation, labels de formulaire, en-têtes de tableau, titres de section, informations portées par une couleur).
7. Vérifier la typographie : tout `font-size` (CSS ou inline) sur du code touché par la tâche en cours doit utiliser un token `--text-*` de `tokens.css`, pas une valeur px/rem arbitraire. La migration complète étant terminée (2026-08-29), tout `font-size` en px trouvé n'importe où dans le projet — pas seulement le fichier touché — est une régression à corriger immédiatement, pas une dette à différer.
8. Vérifier la hiérarchie visuelle des titres (H1/H2/H3, voir tableau et règle d'espacement "Hiérarchie visuelle des titres" ci-dessus) : chaque titre structurant réel utilise bien `<h2>`/`<h3 class="section-title">` (pas un `<div>`/`<span>` stylé) ; seul le tout premier titre de la page/modale a `margin-top:0` en inline (pas chaque sous-bloc/zone qui suit — sinon un espace de 32px manque là où il devrait marquer une nouvelle section) ; aucun `border-top` n'accompagne un titre ou le bloc juste avant lui (l'espacement seul doit porter la séparation) ; `.section-title` n'est pas réutilisée sur un simple label inline (ex: `.form-label` attendu à la place).

## Corrections automatiques

Appliquer directement les corrections sûres et mécaniques (remplacer une classe CSS par la classe attendue du tableau, aligner un espacement/rayon sur `tokens.css`, remplacer un `font-size` en px par le token `--text-*` le plus proche, dupliquer une règle de validation manquante sur un champ équivalent, ajouter un `aria-label`/`role`/`aria-live` manquant conforme au tableau d'accessibilité ci-dessus, ajouter un `for=` manquant sur un `<label>`, ajouter un `scope="col"`/`scope="row"` manquant sur un `<th>`, convertir un `<div>`/`<span>` de titre visuel en vraie balise Hn au bon niveau). Ne **pas** corriger seul(e) un cas ambigu où plusieurs conventions existantes pourraient légitimement gagner (ex: si deux styles de boutons ont chacun des usages nombreux), ni un cas qui demande de restructurer un composant custom en éléments sémantiques natifs, ni changer la valeur d'un token `--text-*` dans `tokens.css` (le plancher à 0,8rem est une décision utilisateur explicite, pas un réglage à ajuster de sa propre initiative) — le signaler à l'utilisateur pour trancher avant d'agir.

## Rapport

Lister chaque incohérence trouvée : fichier, ligne, ce qui cloche, la correction attendue. Distinguer clairement ce qui a été corrigé automatiquement de ce qui reste à trancher manuellement.
