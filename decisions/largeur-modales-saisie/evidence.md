# Evidence — Largeur des modales de saisie

Rôle de ce fichier : ancrer la décision dans la réalité. Pas de solution ici, juste ce qu'on sait vraiment.

## Constat déclencheur

Après la refonte de "Suivre la demande" (voir `decisions/vue-prestation-macro-micro/`), l'utilisateur a remarqué qu'en naviguant depuis cette popup — "Réglages de la prestation", "Modifier" un consultant, "Voir l'opportunité" — l'écran change de largeur à chaque fois, sans logique perceptible pour quelqu'un qui enchaîne ces actions dans une même tâche.

## Verbatims (conversation du 2026-10-18/19)

> "quand tu es dans suivi voir 3 modales de tailles différentes qui partage des points communs en UX et parfois en fonction (comme les pauses). c'est étrange pour un utilisateur non ?"

> "j'ai besoin qu'en terme UX les choses soit fluide, cohérente et intuitive. je comprends que mathématiquement le rendu soit juste mais le feeling. lui ne suit pas. c'est toute la joie et le plaisir de faire de l'UX."

## Ce qui existait avant (justifications locales, chacune individuellement correcte)

- `.modal-box` par défaut : 580px — toute modale sans raison particulière.
- `#opportunite-modal-box, #prest-modal-box` : 900px — exception documentée, Opportunité et Prestation "sont les 2 étapes d'une même continuité", l'Opportunité ayant besoin de place pour N candidatures avec leurs pushs/soutenances.
- `#suivi-demande-box` : plein écran, statique dans le HTML (`overlay-fullscreen`), quel que soit le mode (groupé ou legacy).
- `#prestation-reglages-modal-box` : 580px, pas d'exception (formulaire jugé simple).

Chacune de ces largeurs était défendable isolément. Le problème n'était pas leur justesse individuelle, mais l'expérience de les traverser dans un même parcours.

## Ce qui a changé le regard : le hub "Suivre la demande"

Cette justification au cas par cas datait d'avant la construction du mécanisme de retour automatique (`suiviDemandeReturnEntity`/`returnToSuiviDemande()`, voir `decisions/vue-prestation-macro-micro/`) : "Suivre la demande" n'est plus une popup parmi d'autres, c'est l'écran central d'où partent et reviennent Réglages, Modifier un consultant, et Voir l'opportunité — un seul parcours continu, pas 3 actions indépendantes. Le raisonnement "chaque modale sa largeur selon son contenu" n'avait jamais été réévalué à l'aune de cette fréquence d'aller-retour.

## Vérifications de code faites avant de trancher

- `#opportunite-modal-box` n'est **jamais** ouverte en standalone avec une opportunité déjà existante et des candidats à gérer — ce cas passe systématiquement par `openSuiviDemandeLegacy()`, donc toujours plein écran avant ce travail. Le seul usage standalone (`openOpportuniteModal(null, ...)`) est la création pure, où `modalCandidatures` est toujours vide : rien de dense à afficher à ce moment-là.
- Aucune bascule en direct entre mode legacy et mode groupé au sein d'une même session de la popup : gagner une candidature (`markCandidatureWonInModal()`) ferme "Suivre la demande" et ouvre une modale Prestation séparée — pas de redimensionnement brutal à gérer pendant que l'utilisateur travaille.
