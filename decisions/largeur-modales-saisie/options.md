# Options — Largeur des modales de saisie

Rôle de ce fichier : peser les alternatives avant de trancher. Voir [evidence.md](evidence.md) pour le constat.

## Option 1 — Ne rien changer

Garder chaque largeur justifiée individuellement par son contenu (580/900/plein écran selon la modale). Écartée : ne répond pas au problème identifié, qui est la fluidité du parcours, pas la justesse de chaque largeur prise seule.

## Option 2 — Largeur unique partout, y compris le mode groupé de "Suivre la demande"

Tout mettre à 900px, sans exception. Écartée : le mode groupé (KPI + graphiques + tableau + frise) a une densité réelle que 900px ne suffirait pas à contenir confortablement — testé mentalement, pas en maquette, le besoin de plein écran pour cette vue précise n'a jamais été remis en question dans la conversation.

## Option 3 (retenue) — Largeur extérieure commune (900px) pour les modales de saisie, plein écran réservé au mode groupé

Opportunité, Prestation, Réglages de la prestation et "Suivre la demande" en mode legacy partagent 900px. Seul le mode groupé de "Suivre la demande" reste plein écran, parce que c'est la seule vue dont la densité le justifie — pas parce qu'elle est pilotée par "Suivre la demande".

**Sous-question tranchée en testant, pas en discutant** : le nombre de colonnes à l'intérieur de ces 900px doit-il, lui aussi, être unique (3 colonnes partout) ?

- Testé d'abord sur Réglages de la prestation (5 champs) : 3 colonnes à 900px laisse une 2ᵉ ligne avec seulement 2 cases sur 3 remplies — jugé moins lisible que 2 colonnes par l'utilisateur, à l'aveugle (maquette 580px/2col vs 900px/3col comparées côte à côte).
- Retesté sur Opportunité (~11 champs) avec le même motif à 3 colonnes : validé ("3 colonnes" — réponse directe).
- Conclusion : le nombre de colonnes n'est pas une question de largeur extérieure, c'est une question de densité de champs. Réglages garde 2 colonnes à l'intérieur de sa modale à 900px ; Opportunité et Prestation (assez de champs) passent à 3 colonnes même en standalone, pas seulement quand elles sont embarquées dans "Suivre la demande" comme c'était le cas avant.

## Question ouverte, non traitée dans ce lot

Les grilles à colonnes fixes qui ne font pas partie des formulaires principaux (candidatures push/soutenance dans Opportunité, pastilles pause/absence dans la frise groupée) n'ont pas de repli à 1 colonne à l'étroit — identifié en testant le responsive après ce changement, mais pas corrigé ici. Noté au `BACKLOG.md` (2026-10-19).
