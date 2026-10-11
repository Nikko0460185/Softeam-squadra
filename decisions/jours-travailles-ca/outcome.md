# Outcome — Calcul des jours travaillés et du CA

Rôle de ce fichier : ce qui a été livré, une fois les décisions passées à l'exécution. Voir [evidence.md](evidence.md) et [options.md](options.md) pour le constat et les alternatives pesées.

## Ce qui a été fait (2026-10-11) — Option 4 + Option 5

**Modèle de données**
- `data/consultants.json` : nouveau champ optionnel `absences` (`{ startDate, endDate, period? }`) — périodes "non travaillées", journée complète ou demi-journée (matin/après-midi), sans raison enregistrée. Saisie manuelle dans la modale Consultant (section "Absences", même patron visuel que "Révisions du coût complet").
- `data/prestations.json` : nouveau champ optionnel `prixForfait` (number, €) — prix fixé à l'avance pour un forfait, sans historique de révisions (contrairement au TJM d'une mission).

**Modale Prestation** ([index.html](../../index.html), [main.js](../../main.js)) — `updateLockedSections()` bascule maintenant aussi selon `nature` (en plus de existing/fromOpp) : TJM + révisions pour une mission, prix forfaitaire pour un forfait, aucun champ de prix pour un projet interne. Validation adaptée dans `commitPrestationFromForm()`.

**Calcul du CA** (`periodData()`, [main.js](../../main.js)) — devenu sensible à la nature :
- Mission : CA réduit par les jours non travaillés (pause de mission **ou** absence individuelle du consultant, jamais les deux cumulées le même jour — nouvelle fonction `unavailableFraction()`).
- Forfait : CA = `prixForfait` proratisé sur la durée totale de l'engagement, jamais réduit par une absence/pause.
- Projet interne : CA = 0, toujours.
- `avgTjm` restreint aux missions uniquement.

**Documentation** — `README.md` mis à jour (`absences`, `prixForfait`, et précision sur l'effet de `nature` sur le calcul du CA ; la note périmée "les Statistiques ne tiennent pas encore compte des pauses" a été corrigée).

## Vérification

- `node --check main.js` : syntaxe valide.
- Backend vérifié de bout en bout avec `verify-squadra-backend` (incluant un round-trip explicite du nouveau champ `absences`) : fichiers statiques OK, round-trip d'écriture OK, robustesse JSON invalide OK, nettoyage/restauration des données réelles OK.
- Rendu visuel confirmé fonctionnel par l'utilisateur le 2026-10-11 (test manuel dans le navigateur, pas d'outil de navigateur automatisé disponible dans cet environnement).
