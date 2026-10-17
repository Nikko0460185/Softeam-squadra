# Outcome — Largeur des modales de saisie

Rôle de ce fichier : ce qui a été livré, une fois la décision passée à l'exécution. Voir [evidence.md](evidence.md) et [options.md](options.md) pour le constat et les alternatives pesées.

## Livré le 2026-10-19

**Largeur extérieure, 900px commun** (`styles/organisms/modal.css`) : `#opportunite-modal-box, #prest-modal-box, #prestation-reglages-modal-box, #suivi-demande-box` partagent désormais le même `max-width`. Réglages de la prestation passe de 580px à 900px ; aucun changement pour Opportunité/Prestation (déjà à 900px).

**Plein écran conditionnel pour "Suivre la demande"** : la classe `overlay-fullscreen` n'est plus statique dans `index.html`, elle est posée par `openSuiviDemandeGroup()` et retirée par `openSuiviDemandeLegacy()` (`main.js`). Mode groupé = plein écran ; mode legacy = 900px, comme "Ajouter une opportunité" dont il réutilise le même `#opportunite-modal-box` embarqué.

**Nombre de colonnes, propre à chaque modale** (`.sd-fields-3col`, `styles/organisms/modal.css`) : la règle passe de `.suivi-demande-embedded .sd-fields-3col` (3 colonnes seulement quand embarquée dans "Suivre la demande") à `.sd-fields-3col` tout court (3 colonnes tout le temps, y compris en standalone) — s'applique à Opportunité (Modalités + Tarification) et Prestation (Modalités). Réglages de la prestation n'utilise pas `.sd-fields-3col`, garde `.form-row` à 2 colonnes — délibérément, pas un oubli (voir options.md).

**Responsive, 1 colonne en dessous de 900px** : nouvelle règle `@media (max-width: 900px) { .form-row, .form-row-3, .form-row-4, .sd-fields-3col { grid-template-columns: 1fr; } }` — même seuil que le reste du projet (`tokens.css`). N'a pas été étendue à `.opp-cand-body` ni `.sd-tl-lane-chips`, qui n'utilisent pas ces classes communes (candidats au backlog, voir options.md).

## Vérification

- `node --check main.js`/`server.js` : syntaxe valide.
- Balance des balises `<div>` (247/247) et des accolades CSS (`styles/organisms/modal.css`) vérifiée après chaque étape.
- Fichiers statiques servis sans erreur après chaque redémarrage du serveur.
- Pas de changement de `data/*.json` ni de `server.js` dans ce lot — pas de vérification backend nécessaire.
- Scénario vérifié par raisonnement sur le code (pas de bascule en direct mode legacy ↔ groupé pendant qu'une session de la popup est ouverte, donc pas de redimensionnement brutal à craindre) — confirmé par l'utilisateur en situation réelle après implémentation.
- **Non vérifié avant implémentation** : la section "Modalités de la prestation" (Prestation standalone, 6 champs) en 3 colonnes n'a pas été maquettée séparément avant d'être généralisée — inférée par analogie avec Opportunité (densité de champs comparable), signalé explicitement à l'utilisateur comme tel au moment de l'implémentation.
